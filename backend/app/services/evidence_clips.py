import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.core.config import Settings, get_settings
from app.db.session import AsyncSessionLocal
from app.repositories.cameras import list_cameras, to_camera_schema
from app.repositories.reporting import (
    delete_expired_evidence_clip_models,
    get_evidence_clip,
    list_pending_evidence_clip_ids,
    update_evidence_clip_status,
)
from app.repositories.recordings import get_recording_model
from app.schemas import Camera, EvidenceClipResponse, RecordingSegment
from app.services.recording_archiver import resolve_archive_file
from app.services.media_validation import (
    MediaValidationError,
    covers_time_range,
    validate_rendered_video,
)
from app.services.recording_segments import (
    get_recording_segment_file,
    list_recording_segments,
)

logger = logging.getLogger(__name__)

_RUNNING_TASKS: dict[str, asyncio.Task[None]] = {}
_FFMPEG_SEMAPHORE = asyncio.Semaphore(1)
_CLIP_ID_PATTERN = re.compile(r"^clip-[a-f0-9]{8}$")


class EvidenceClipProcessingError(RuntimeError):
    pass


@dataclass(frozen=True)
class ClipSource:
    path: Path
    start_time: datetime
    end_time: datetime


@dataclass(frozen=True)
class ClipRenderPlan:
    sources: list[ClipSource]
    offset_seconds: float
    duration_seconds: float


def schedule_evidence_clip(clip_id: str) -> None:
    current = _RUNNING_TASKS.get(clip_id)
    if current and not current.done():
        return

    task = asyncio.create_task(_process_evidence_clip(clip_id))
    _RUNNING_TASKS[clip_id] = task
    task.add_done_callback(lambda _: _RUNNING_TASKS.pop(clip_id, None))


async def recover_pending_evidence_clips() -> None:
    clip_ids: list[str] = []
    for attempt in range(12):
        try:
            async with AsyncSessionLocal() as session:
                clip_ids = await list_pending_evidence_clip_ids(session)
            break
        except Exception:
            if attempt == 11:
                logger.exception("Evidence clip recovery could not reach PostgreSQL")
                return
            await asyncio.sleep(5)
    for clip_id in clip_ids:
        schedule_evidence_clip(clip_id)


async def run_evidence_clip_cleanup(
    settings: Settings | None = None,
    *,
    run_once: bool = False,
) -> None:
    settings = settings or get_settings()
    while True:
        try:
            await cleanup_expired_evidence_clips(settings)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Pembersihan evidence clip kedaluwarsa gagal")

        if run_once:
            return
        await asyncio.sleep(max(60, settings.evidence_clip_cleanup_poll_seconds))


async def cleanup_expired_evidence_clips(
    settings: Settings | None = None,
    *,
    now: datetime | None = None,
) -> int:
    settings = settings or get_settings()
    cutoff = _aware(now or datetime.now(UTC)) - timedelta(
        days=max(1, settings.evidence_clip_retention_days)
    )
    async with AsyncSessionLocal() as session:
        expired_ids = await delete_expired_evidence_clip_models(session, cutoff)

    for clip_id in expired_ids:
        _delete_clip_files(clip_id, settings)
    if expired_ids:
        logger.info("Menghapus %s evidence clip kedaluwarsa", len(expired_ids))
    return len(expired_ids)


async def shutdown_evidence_clip_tasks() -> None:
    tasks = list(_RUNNING_TASKS.values())
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    _RUNNING_TASKS.clear()


def get_evidence_clip_file(clip_id: str) -> Path | None:
    if not _CLIP_ID_PATTERN.fullmatch(clip_id):
        return None

    root = Path(get_settings().media_clips_dir).resolve()
    candidate = (root / f"{clip_id}.mp4").resolve()
    if candidate.parent != root or not candidate.is_file():
        return None
    return candidate


async def _process_evidence_clip(clip_id: str) -> None:
    try:
        async with AsyncSessionLocal() as session:
            clip = await get_evidence_clip(session, clip_id)
            if not clip or clip.status == "ready":
                return
            cameras = [to_camera_schema(item) for item in await list_cameras(session)]
            archive = await get_recording_model(
                session,
                clip.recording_id,
                ready_only=True,
            )

        archive_file = resolve_archive_file(archive.file_path if archive else None)
        archive_source = (
            ClipSource(
                path=archive_file,
                start_time=_aware(archive.start_time),
                end_time=_aware(archive.end_time),
            )
            if archive is not None and archive_file is not None
            else None
        )

        await _set_clip_status(clip_id, "processing")
        plan = await _wait_for_render_plan(
            clip,
            cameras,
            archive_source=archive_source,
        )
        async with _FFMPEG_SEMAPHORE:
            output_path = await _render_clip(clip_id, plan)
        await _set_clip_status(clip_id, "ready", clip_url=_clip_url(clip_id))
        logger.info("Evidence clip %s ready at %s", clip_id, output_path)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Evidence clip %s failed", clip_id)
        try:
            await _set_clip_status(clip_id, "failed")
        except Exception:
            logger.exception(
                "Evidence clip %s failure status could not be saved", clip_id
            )
        _cleanup_output(clip_id)


async def _set_clip_status(
    clip_id: str,
    status: str,
    *,
    clip_url: str | None = None,
) -> None:
    async with AsyncSessionLocal() as session:
        await update_evidence_clip_status(
            session,
            clip_id,
            status,
            clip_url=clip_url,
        )


async def _wait_for_render_plan(
    clip: EvidenceClipResponse,
    cameras: list[Camera],
    *,
    archive_source: ClipSource | None = None,
) -> ClipRenderPlan:
    settings = get_settings()
    archive_plan = _build_single_source_plan(clip, archive_source)
    if archive_plan and _plan_covers_request(archive_plan, clip):
        return archive_plan

    deadline = (
        asyncio.get_running_loop().time() + settings.evidence_clip_source_wait_seconds
    )
    finalized_at = _aware(clip.end_time) + timedelta(
        seconds=settings.media_record_segment_duration_seconds + 2
    )
    initial_delay = (finalized_at - datetime.now(UTC)).total_seconds()
    if initial_delay > 0:
        await asyncio.sleep(
            min(initial_delay, max(0, deadline - asyncio.get_running_loop().time()))
        )

    latest_plan: ClipRenderPlan | None = None
    while True:
        latest_plan = _build_render_plan(clip, cameras)
        if latest_plan and _plan_covers_request(latest_plan, clip):
            return latest_plan

        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            if latest_plan:
                raise EvidenceClipProcessingError(
                    "Segment MediaMTX belum lengkap untuk seluruh rentang clip."
                )
            raise EvidenceClipProcessingError(
                "Tidak ada segment MediaMTX yang mencakup rentang clip."
            )
        await asyncio.sleep(min(5, remaining))


def _build_single_source_plan(
    clip: EvidenceClipResponse,
    source: ClipSource | None,
) -> ClipRenderPlan | None:
    if source is None:
        return None

    clip_start = _aware(clip.start_time)
    clip_end = _aware(clip.end_time)
    actual_start = max(clip_start, source.start_time)
    actual_end = min(clip_end, source.end_time)
    duration = (actual_end - actual_start).total_seconds()
    if duration < 1:
        return None

    return ClipRenderPlan(
        sources=[source],
        offset_seconds=max(0, (actual_start - source.start_time).total_seconds()),
        duration_seconds=duration,
    )


def _build_render_plan(
    clip: EvidenceClipResponse,
    cameras: list[Camera],
) -> ClipRenderPlan | None:
    clip_start = _aware(clip.start_time)
    clip_end = _aware(clip.end_time)
    segments = list_recording_segments(
        camera_id=clip.camera_id,
        date_from=clip_start,
        date_to=clip_end,
        cameras=cameras,
    )

    sources: list[ClipSource] = []
    for segment in sorted(segments, key=lambda item: item.start_time):
        if not _overlaps(segment, clip_start, clip_end):
            continue
        file_path = get_recording_segment_file(segment.id)
        if file_path:
            sources.append(
                ClipSource(
                    path=file_path,
                    start_time=_aware(segment.start_time),
                    end_time=_aware(segment.end_time),
                )
            )

    if not sources:
        return None

    source_start = sources[0].start_time
    source_end = max(item.end_time for item in sources)
    actual_start = max(clip_start, source_start)
    actual_end = min(clip_end, source_end)
    duration = (actual_end - actual_start).total_seconds()
    if duration < 1:
        return None

    return ClipRenderPlan(
        sources=sources,
        offset_seconds=max(0, (actual_start - source_start).total_seconds()),
        duration_seconds=duration,
    )


def _plan_covers_request(
    plan: ClipRenderPlan,
    clip: EvidenceClipResponse,
    *,
    tolerance_seconds: float | None = None,
) -> bool:
    tolerance = (
        get_settings().evidence_clip_gap_tolerance_seconds
        if tolerance_seconds is None
        else tolerance_seconds
    )
    return covers_time_range(
        ((source.start_time, source.end_time) for source in plan.sources),
        _aware(clip.start_time),
        _aware(clip.end_time),
        tolerance_seconds=tolerance,
    )


def _overlaps(
    segment: RecordingSegment,
    clip_start: datetime,
    clip_end: datetime,
) -> bool:
    return (
        _aware(segment.end_time) > clip_start and _aware(segment.start_time) < clip_end
    )


async def _render_clip(clip_id: str, plan: ClipRenderPlan) -> Path:
    settings = get_settings()
    output_root = Path(settings.media_clips_dir)
    output_root.mkdir(parents=True, exist_ok=True)
    manifest_path = output_root / f".{clip_id}.ffconcat"
    temporary_path = output_root / f".{clip_id}.part.mp4"
    output_path = output_root / f"{clip_id}.mp4"

    manifest_path.write_text(_concat_manifest(plan.sources), encoding="utf-8")
    temporary_path.unlink(missing_ok=True)
    output_path.unlink(missing_ok=True)

    command = _ffmpeg_command(
        ffmpeg_binary=settings.ffmpeg_binary,
        manifest_path=manifest_path,
        output_path=temporary_path,
        offset_seconds=plan.offset_seconds,
        duration_seconds=plan.duration_seconds,
    )

    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=settings.evidence_clip_ffmpeg_timeout_seconds,
        )
    except TimeoutError as error:
        process.kill()
        await process.communicate()
        raise EvidenceClipProcessingError(
            "FFmpeg melewati batas waktu proses."
        ) from error
    finally:
        manifest_path.unlink(missing_ok=True)

    if process.returncode != 0:
        message = stderr.decode("utf-8", errors="replace").strip()[-1200:]
        temporary_path.unlink(missing_ok=True)
        raise EvidenceClipProcessingError(message or "FFmpeg gagal membuat clip.")
    if not temporary_path.is_file() or temporary_path.stat().st_size < 1024:
        temporary_path.unlink(missing_ok=True)
        raise EvidenceClipProcessingError("Hasil clip FFmpeg kosong.")

    try:
        await validate_rendered_video(
            temporary_path,
            expected_duration_seconds=plan.duration_seconds,
            duration_tolerance_seconds=(
                settings.evidence_clip_output_duration_tolerance_seconds
            ),
            ffprobe_binary=settings.ffprobe_binary,
            timeout_seconds=settings.ffprobe_timeout_seconds,
        )
    except MediaValidationError as error:
        temporary_path.unlink(missing_ok=True)
        raise EvidenceClipProcessingError(str(error)) from error

    temporary_path.replace(output_path)
    return output_path


def _ffmpeg_command(
    *,
    ffmpeg_binary: str,
    manifest_path: Path,
    output_path: Path,
    offset_seconds: float,
    duration_seconds: float,
) -> list[str]:
    return [
        ffmpeg_binary,
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
        f"{duration_seconds:.3f}",
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        str(output_path),
    ]


def _concat_manifest(sources: list[ClipSource]) -> str:
    lines = ["ffconcat version 1.0"]
    lines.extend(f"file '{_escape_concat_path(item.path)}'" for item in sources)
    return "\n".join(lines) + "\n"


def _escape_concat_path(path: Path) -> str:
    return path.resolve().as_posix().replace("'", "'\\''")


def _clip_url(clip_id: str) -> str:
    return f"/api/recordings/clips/{clip_id}/media"


def _cleanup_output(clip_id: str) -> None:
    root = Path(get_settings().media_clips_dir)
    for name in (f".{clip_id}.ffconcat", f".{clip_id}.part.mp4"):
        (root / name).unlink(missing_ok=True)


def _delete_clip_files(clip_id: str, settings: Settings) -> None:
    if not _CLIP_ID_PATTERN.fullmatch(clip_id):
        logger.warning("Lewati cleanup evidence clip dengan ID tidak valid: %s", clip_id)
        return
    root = Path(settings.media_clips_dir)
    for name in (
        f"{clip_id}.mp4",
        f".{clip_id}.ffconcat",
        f".{clip_id}.part.mp4",
    ):
        (root / name).unlink(missing_ok=True)


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
