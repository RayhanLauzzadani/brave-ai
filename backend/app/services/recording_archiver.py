from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.core.config import Settings, get_settings
from app.db.session import AsyncSessionLocal
from app.repositories.cameras import list_cameras, to_camera_schema
from app.repositories.recordings import (
    delete_recording_model,
    get_recording_model,
    list_expired_recording_models,
    list_ready_recording_models,
    mark_recording_failed,
    mark_recording_ready,
    reserve_recording_archive,
)
from app.schemas import Camera, RecordingSegment
from app.services.media_validation import (
    MediaValidationError,
    covers_time_range,
    validate_rendered_video,
)
from app.services.camera_connections import probe_camera_connection
from app.services.recording_segments import list_recording_segments

logger = logging.getLogger("brave-ai.recording-archiver")


class RecordingArchiveError(RuntimeError):
    pass


@dataclass(frozen=True)
class ArchiveWindow:
    id: str
    camera_id: str
    media_path: str
    start_time: datetime
    end_time: datetime
    segments: tuple[RecordingSegment, ...]
    source_offset_seconds: float

    @property
    def duration_seconds(self) -> int:
        return round((self.end_time - self.start_time).total_seconds())


async def run_recording_archiver(
    settings: Settings | None = None,
    *,
    run_once: bool = False,
) -> None:
    settings = settings or get_settings()
    while True:
        try:
            await archive_completed_recordings(settings)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Siklus arsip rekaman gagal")

        if run_once:
            return
        await asyncio.sleep(max(5, settings.recording_archive_poll_seconds))


async def archive_completed_recordings(settings: Settings) -> None:
    await delete_expired_recordings(settings)

    async with AsyncSessionLocal() as session:
        camera_models = await list_cameras(session)
        ready_models = await list_ready_recording_models(session)
    cameras = [to_camera_schema(camera) for camera in camera_models]
    resume_after_by_source: dict[tuple[str, str], datetime] = {}
    for model in ready_models:
        if resolve_archive_file(model.file_path, settings) is None:
            continue
        source_key = (model.camera_id, model.media_path)
        current = resume_after_by_source.get(source_key)
        if current is None or _aware(model.end_time) > current:
            resume_after_by_source[source_key] = _aware(model.end_time)

    finalized_before = datetime.now(UTC) - timedelta(seconds=2)
    segments = [
        segment
        for segment in list_recording_segments(cameras=cameras)
        if _aware(segment.end_time) <= finalized_before
    ]
    active_source_keys = await _active_recording_source_keys(cameras)
    windows = build_archive_windows(
        segments,
        session_duration_seconds=settings.recording_session_duration_seconds,
        expected_segment_seconds=settings.media_record_segment_duration_seconds,
        gap_tolerance_seconds=settings.recording_archive_gap_tolerance_seconds,
        resume_after_by_source=resume_after_by_source,
        active_source_keys=active_source_keys,
    )
    cameras_by_id = {camera.id: camera for camera in cameras}

    for window in windows:
        camera = cameras_by_id.get(window.camera_id)
        async with AsyncSessionLocal() as session:
            existing = await get_recording_model(session, window.id)
        if existing and existing.archive_status == "ready":
            archive_file = resolve_archive_file(existing.file_path, settings)
            if archive_file is not None:
                continue

        await _archive_window(window, camera, settings)


async def _active_recording_source_keys(
    cameras: list[Camera],
) -> set[tuple[str, str]]:
    candidates = [camera for camera in cameras if camera.media_path]
    if not candidates:
        return set()

    statuses = await asyncio.gather(
        *(
            probe_camera_connection(camera.id, camera.media_path)
            for camera in candidates
        ),
        return_exceptions=True,
    )
    return {
        (camera.id, camera.media_path)
        for camera, status in zip(candidates, statuses, strict=True)
        if not isinstance(status, BaseException) and status.connected
    }


def build_archive_windows(
    segments: list[RecordingSegment],
    *,
    session_duration_seconds: int,
    expected_segment_seconds: int,
    gap_tolerance_seconds: int,
    resume_after_by_source: dict[tuple[str, str], datetime] | None = None,
    active_source_keys: set[tuple[str, str]] | None = None,
) -> list[ArchiveWindow]:
    if session_duration_seconds <= 0:
        raise ValueError("Durasi sesi rekaman harus lebih dari nol")

    grouped: dict[tuple[str, str], list[RecordingSegment]] = {}
    for segment in segments:
        grouped.setdefault((segment.camera_id, segment.media_path), []).append(segment)

    windows: list[ArchiveWindow] = []
    resume_points = resume_after_by_source or {}
    for (camera_id, media_path), items in grouped.items():
        source_key = (camera_id, media_path)
        ordered = sorted(items, key=lambda item: _aware(item.start_time))
        chains = _continuous_chains(
            ordered,
            expected_segment_seconds=expected_segment_seconds,
            gap_tolerance_seconds=gap_tolerance_seconds,
        )
        source_is_active = (
            active_source_keys is None or source_key in active_source_keys
        )
        for chain_index, chain in enumerate(chains):
            is_latest_chain = chain_index == len(chains) - 1
            windows.extend(
                _windows_for_chain(
                    camera_id,
                    media_path,
                    chain,
                    session_duration_seconds=session_duration_seconds,
                    gap_tolerance_seconds=gap_tolerance_seconds,
                    resume_after=resume_points.get(source_key),
                    include_partial_tail=not (
                        source_is_active and is_latest_chain
                    ),
                )
            )

    return sorted(windows, key=lambda item: item.start_time)


def archive_ffmpeg_command(
    *,
    settings: Settings,
    manifest_path: Path,
    output_path: Path,
    offset_seconds: float,
    duration_seconds: int,
) -> list[str]:
    video_filter = (
        f"scale=w='min({settings.recording_archive_video_max_width},iw)':"
        f"h='min({settings.recording_archive_video_max_height},ih)':"
        "force_original_aspect_ratio=decrease:force_divisible_by=2,"
        f"fps={settings.recording_archive_video_fps}"
    )
    max_bitrate = settings.recording_archive_video_max_bitrate_kbps
    return [
        settings.ffmpeg_binary,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(manifest_path),
        "-ss",
        f"{offset_seconds:.3f}",
        "-t",
        str(duration_seconds),
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        video_filter,
        "-c:v",
        "libx264",
        "-preset",
        settings.recording_archive_video_preset,
        "-crf",
        str(settings.recording_archive_video_crf),
        "-maxrate",
        f"{max_bitrate}k",
        "-bufsize",
        f"{max_bitrate * 2}k",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        f"{settings.recording_archive_audio_bitrate_kbps}k",
        "-movflags",
        "+faststart",
        str(output_path),
    ]


def resolve_archive_file(
    file_path: str | None, settings: Settings | None = None
) -> Path | None:
    if not file_path:
        return None
    settings = settings or get_settings()
    root = Path(settings.media_archive_dir).resolve()
    candidate = (root / file_path).resolve()
    if root not in candidate.parents or not candidate.is_file():
        return None
    return candidate


async def delete_expired_recordings(settings: Settings) -> None:
    async with AsyncSessionLocal() as session:
        expired = await list_expired_recording_models(session)
        for model in expired:
            file_path = resolve_archive_file(model.file_path, settings)
            if file_path:
                file_path.unlink(missing_ok=True)
            await delete_recording_model(session, model)
            logger.info("Rekaman %s dihapus setelah masa simpan berakhir", model.id)


async def _archive_window(
    window: ArchiveWindow,
    camera: Camera | None,
    settings: Settings,
) -> None:
    camera_name = camera.name if camera else window.media_path
    location = camera.location if camera else "MediaMTX Gateway"
    async with AsyncSessionLocal() as session:
        await reserve_recording_archive(
            session,
            recording_id=window.id,
            camera_id=window.camera_id,
            media_path=window.media_path,
            camera_name=camera_name,
            location=location,
            start_time=window.start_time,
            end_time=window.end_time,
            duration_seconds=window.duration_seconds,
            source_segment_count=len(window.segments),
        )

    try:
        output_path, relative_path, rendered_duration_seconds = await _render_archive(
            window, settings
        )
        available_at = datetime.now(UTC)
        expires_at = available_at + timedelta(
            days=settings.recording_archive_retention_days
        )
        async with AsyncSessionLocal() as session:
            await mark_recording_ready(
                session,
                window.id,
                file_path=relative_path,
                file_size=output_path.stat().st_size,
                duration_seconds=max(1, round(rendered_duration_seconds)),
                available_at=available_at,
                expires_at=expires_at,
            )
        logger.info("Rekaman sesi %s siap di %s", window.id, output_path)
    except Exception as error:
        logger.exception("Rekaman sesi %s gagal diproses", window.id)
        async with AsyncSessionLocal() as session:
            await mark_recording_failed(session, window.id, str(error))
        _cleanup_partial_archive(window, settings)


async def _render_archive(
    window: ArchiveWindow,
    settings: Settings,
) -> tuple[Path, str, float]:
    sources = [_resolve_segment_file(segment, settings) for segment in window.segments]
    if any(path is None for path in sources):
        raise RecordingArchiveError("Satu atau lebih segment sumber tidak tersedia")
    source_paths = [path for path in sources if path is not None]

    output_root = Path(settings.media_archive_dir)
    camera_folder = _safe_path_part(window.camera_id)
    target_dir = output_root / camera_folder
    target_dir.mkdir(parents=True, exist_ok=True)
    base_name = window.start_time.astimezone(UTC).strftime("%Y-%m-%dT%H-%M-%SZ")
    manifest_path = target_dir / f".{base_name}.ffconcat"
    temporary_path = target_dir / f".{base_name}.part.mp4"
    output_path = target_dir / f"{base_name}.mp4"

    manifest_path.write_text(_concat_manifest(source_paths), encoding="utf-8")
    temporary_path.unlink(missing_ok=True)
    output_path.unlink(missing_ok=True)
    command = archive_ffmpeg_command(
        settings=settings,
        manifest_path=manifest_path,
        output_path=temporary_path,
        offset_seconds=window.source_offset_seconds,
        duration_seconds=window.duration_seconds,
    )
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=settings.recording_archive_ffmpeg_timeout_seconds,
        )
    except TimeoutError as error:
        process.kill()
        await process.communicate()
        raise RecordingArchiveError("FFmpeg melewati batas waktu arsip") from error
    finally:
        manifest_path.unlink(missing_ok=True)

    if process.returncode != 0:
        message = stderr.decode("utf-8", errors="replace").strip()[-2000:]
        temporary_path.unlink(missing_ok=True)
        raise RecordingArchiveError(message or "FFmpeg gagal membuat arsip")
    if not temporary_path.is_file() or temporary_path.stat().st_size < 1024:
        temporary_path.unlink(missing_ok=True)
        raise RecordingArchiveError("Hasil arsip FFmpeg kosong")

    try:
        probe = await validate_rendered_video(
            temporary_path,
            expected_duration_seconds=window.duration_seconds,
            duration_tolerance_seconds=(
                settings.recording_archive_output_duration_tolerance_seconds
            ),
            ffprobe_binary=settings.ffprobe_binary,
            timeout_seconds=settings.ffprobe_timeout_seconds,
        )
    except MediaValidationError as error:
        temporary_path.unlink(missing_ok=True)
        raise RecordingArchiveError(str(error)) from error

    temporary_path.replace(output_path)
    relative_path = output_path.relative_to(output_root).as_posix()
    return output_path, relative_path, probe.duration_seconds


def _continuous_chains(
    segments: list[RecordingSegment],
    *,
    expected_segment_seconds: int,
    gap_tolerance_seconds: int,
) -> list[list[RecordingSegment]]:
    chains: list[list[RecordingSegment]] = []
    current: list[RecordingSegment] = []
    maximum_start_gap = expected_segment_seconds + max(0, gap_tolerance_seconds)
    for segment in segments:
        if current:
            elapsed_from_previous_start = (
                _aware(segment.start_time) - _aware(current[-1].start_time)
            ).total_seconds()
            if elapsed_from_previous_start <= 0:
                continue
            uncovered_since_previous = max(
                0.0,
                (
                    _aware(segment.start_time) - _aware(current[-1].end_time)
                ).total_seconds(),
            )
            if (
                elapsed_from_previous_start > maximum_start_gap
                or uncovered_since_previous > max(0, gap_tolerance_seconds)
            ):
                chains.append(current)
                current = []
        current.append(segment)
    if current:
        chains.append(current)
    return chains


def _windows_for_chain(
    camera_id: str,
    media_path: str,
    chain: list[RecordingSegment],
    *,
    session_duration_seconds: int,
    gap_tolerance_seconds: int,
    resume_after: datetime | None = None,
    include_partial_tail: bool = False,
) -> list[ArchiveWindow]:
    if not chain:
        return []
    chain_start = _aware(chain[0].start_time)
    chain_end = max(_aware(segment.end_time) for segment in chain)
    duration = timedelta(seconds=session_duration_seconds)
    windows: list[ArchiveWindow] = []
    window_start = chain_start
    if resume_after is not None:
        aware_resume_after = _aware(resume_after)
        if chain_start <= aware_resume_after <= chain_end:
            window_start = aware_resume_after

    while window_start < chain_end:
        full_window_end = window_start + duration
        is_full_window = full_window_end <= chain_end
        if not is_full_window and not include_partial_tail:
            break

        window_end = min(full_window_end, chain_end)
        if (window_end - window_start).total_seconds() < 1:
            break
        sources = tuple(
            segment
            for segment in chain
            if _aware(segment.end_time) > window_start
            and _aware(segment.start_time) < window_end
        )
        if not sources:
            break
        if covers_time_range(
            (
                (_aware(segment.start_time), _aware(segment.end_time))
                for segment in sources
            ),
            window_start,
            window_end,
            tolerance_seconds=gap_tolerance_seconds,
        ):
            source_start = _aware(sources[0].start_time)
            windows.append(
                ArchiveWindow(
                    id=_recording_id(camera_id, window_start),
                    camera_id=camera_id,
                    media_path=media_path,
                    start_time=window_start,
                    end_time=window_end,
                    segments=sources,
                    source_offset_seconds=max(
                        0, (window_start - source_start).total_seconds()
                    ),
                )
            )
        window_start = window_end
        if not is_full_window:
            break

    return windows


def _resolve_segment_file(
    segment: RecordingSegment,
    settings: Settings,
) -> Path | None:
    root = Path(settings.media_recordings_dir).resolve()
    candidate = (root / segment.file_path).resolve()
    if root not in candidate.parents or not candidate.is_file():
        return None
    return candidate


def _concat_manifest(paths: list[Path]) -> str:
    lines = ["ffconcat version 1.0"]
    lines.extend(f"file '{_escape_concat_path(path)}'" for path in paths)
    return "\n".join(lines) + "\n"


def _escape_concat_path(path: Path) -> str:
    return path.resolve().as_posix().replace("'", "'\\''")


def _recording_id(camera_id: str, start_time: datetime) -> str:
    payload = f"{camera_id}|{_aware(start_time).isoformat()}".encode()
    return "rec-" + hashlib.sha256(payload).hexdigest()[:16]


def _safe_path_part(value: str) -> str:
    safe = "".join(
        character if character.isalnum() or character in "-_" else "-"
        for character in value
    )
    return safe.strip("-") or "camera"


def _cleanup_partial_archive(window: ArchiveWindow, settings: Settings) -> None:
    target_dir = Path(settings.media_archive_dir) / _safe_path_part(window.camera_id)
    base_name = window.start_time.astimezone(UTC).strftime("%Y-%m-%dT%H-%M-%SZ")
    for name in (f".{base_name}.ffconcat", f".{base_name}.part.mp4"):
        (target_dir / name).unlink(missing_ok=True)


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
