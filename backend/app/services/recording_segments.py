from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.core.config import get_settings
from app.schemas import Camera, RecordingSegment

MEDIA_RECORDING_SUFFIXES = {".mp4", ".m4s", ".ts", ".mkv"}


def list_recording_segments(
    camera_id: str | None = None,
    media_path: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    cameras: list[Camera] | None = None,
) -> list[RecordingSegment]:
    settings = get_settings()
    root = Path(settings.media_recordings_dir)
    if not root.exists():
        return []

    camera_items = cameras or []
    target_paths = _resolve_target_media_paths(root, camera_id, media_path, camera_items)
    raw_segments: list[tuple[str, str, Path, datetime, int]] = []

    for target_media_path in target_paths:
        path_root = root / target_media_path
        if not path_root.exists():
            continue

        mapped_camera_id = (
            _camera_id_for_media_path(target_media_path, camera_items)
            or camera_id
            or target_media_path
        )
        for file_path in path_root.rglob("*"):
            if not file_path.is_file() or file_path.suffix.lower() not in MEDIA_RECORDING_SUFFIXES:
                continue

            file_size = file_path.stat().st_size
            if file_size < settings.media_record_min_file_size_bytes:
                continue

            raw_segments.append(
                (
                    mapped_camera_id,
                    target_media_path,
                    file_path,
                    _parse_segment_start(file_path, path_root),
                    file_size,
                )
            )

    segments = _build_segments(
        root=root,
        raw_segments=raw_segments,
        default_duration_seconds=settings.media_record_segment_duration_seconds,
    )
    return _filter_segments_by_date(segments, date_from=date_from, date_to=date_to)


def get_recording_segment_file(segment_id: str) -> Path | None:
    settings = get_settings()
    root = Path(settings.media_recordings_dir).resolve()
    if not root.exists():
        return None

    for file_path in root.rglob("*"):
        if not file_path.is_file() or file_path.suffix.lower() not in MEDIA_RECORDING_SUFFIXES:
            continue
        if file_path.stat().st_size < settings.media_record_min_file_size_bytes:
            continue

        resolved = file_path.resolve()
        if root not in resolved.parents:
            continue

        relative_path = resolved.relative_to(root).as_posix()
        if _segment_id(relative_path) == segment_id:
            return resolved

    return None


def _build_segments(
    root: Path,
    raw_segments: list[tuple[str, str, Path, datetime, int]],
    default_duration_seconds: int,
) -> list[RecordingSegment]:
    grouped: dict[str, list[tuple[str, str, Path, datetime, int]]] = {}
    for segment in raw_segments:
        grouped.setdefault(segment[1], []).append(segment)

    segments: list[RecordingSegment] = []
    for group in grouped.values():
        sorted_group = sorted(group, key=lambda segment: segment[3])
        for index, (camera_id, media_path, file_path, start_time, file_size) in enumerate(sorted_group):
            next_start = sorted_group[index + 1][3] if index + 1 < len(sorted_group) else None
            duration = _segment_duration_seconds(
                start_time=start_time,
                next_start=next_start,
                default_duration_seconds=default_duration_seconds,
            )
            end_time = start_time + timedelta(seconds=duration)
            relative_path = file_path.relative_to(root).as_posix()

            segments.append(
                RecordingSegment(
                    id=_segment_id(relative_path),
                    cameraId=camera_id,
                    mediaPath=media_path,
                    filePath=relative_path,
                    mediaUrl=_segment_media_url(relative_path),
                    startTime=start_time,
                    endTime=end_time,
                    duration=duration,
                    fileSize=file_size,
                )
            )

    return sorted(segments, key=lambda segment: segment.start_time, reverse=True)


def _filter_segments_by_date(
    segments: list[RecordingSegment],
    date_from: datetime | None,
    date_to: datetime | None,
) -> list[RecordingSegment]:
    if date_from is None and date_to is None:
        return segments

    aware_from = _ensure_aware(date_from) if date_from else None
    aware_to = _ensure_aware(date_to) if date_to else None
    result = segments
    if aware_from:
        result = [segment for segment in result if segment.end_time >= aware_from]
    if aware_to:
        result = [segment for segment in result if segment.start_time <= aware_to]
    return result


def _resolve_target_media_paths(
    root: Path,
    camera_id: str | None,
    media_path: str | None,
    cameras: list[Camera],
) -> list[str]:
    if media_path:
        return [_clean_media_path(media_path)]

    if camera_id:
        camera = next((item for item in cameras if item.id == camera_id), None)
        if camera and camera.media_path:
            return [camera.media_path]
        return [camera_id]

    camera_media_paths = {camera.media_path for camera in cameras if camera.media_path}
    folder_media_paths = {item.name for item in root.iterdir() if item.is_dir()}
    return sorted(camera_media_paths | folder_media_paths)


def _camera_id_for_media_path(media_path: str, cameras: list[Camera]) -> str | None:
    for camera in cameras:
        if camera.media_path == media_path:
            return camera.id
    return None


def _clean_media_path(value: str) -> str:
    return value.strip().strip("/").replace("\\", "/")


def _parse_segment_start(file_path: Path, path_root: Path) -> datetime:
    try:
        relative = file_path.relative_to(path_root)
        date_part = relative.parts[0]
        time_part = file_path.stem
        return datetime.strptime(
            f"{date_part} {time_part}",
            "%Y-%m-%d %H-%M-%S-%f",
        ).replace(tzinfo=UTC)
    except (IndexError, ValueError):
        return datetime.fromtimestamp(file_path.stat().st_mtime, UTC)


def _segment_duration_seconds(
    start_time: datetime,
    next_start: datetime | None,
    default_duration_seconds: int,
) -> int:
    if next_start and next_start > start_time:
        elapsed = round((next_start - start_time).total_seconds())
        max_reasonable_gap = max(default_duration_seconds * 6, 60)
        if 0 < elapsed <= max_reasonable_gap:
            return elapsed
    return default_duration_seconds


def _ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def _segment_id(relative_path: str) -> str:
    return "seg-" + relative_path.replace("/", "-").replace(".", "-")


def _segment_media_url(relative_path: str) -> str:
    return f"/api/recordings/segments/{_segment_id(relative_path)}/media"