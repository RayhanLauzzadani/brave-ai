from datetime import UTC, datetime

from app.schemas import BullyingLog, Camera, Recording, RecordingSegment


def build_recordings(
    segments: list[RecordingSegment],
    cameras: list[Camera],
    logs: list[BullyingLog],
) -> list[Recording]:
    cameras_by_id = {camera.id: camera for camera in cameras}
    cameras_by_media_path = {
        camera.media_path: camera
        for camera in cameras
        if camera.media_path
    }

    recordings: list[Recording] = []
    for segment in segments:
        camera = (
            cameras_by_id.get(segment.camera_id)
            or cameras_by_media_path.get(segment.media_path)
        )
        camera_id = camera.id if camera else segment.camera_id
        incidents = _incident_logs_for_segment(segment, camera_id, logs)

        recordings.append(
            Recording(
                id=segment.id,
                camera_id=camera_id,
                camera_name=camera.name if camera else segment.media_path,
                location=camera.location if camera else "MediaMTX Gateway",
                start_time=segment.start_time,
                end_time=segment.end_time,
                duration=segment.duration,
                file_url=segment.media_url,
                file_size=segment.file_size,
                has_incident=bool(incidents),
                incident_count=len(incidents),
                thumbnail_url=camera.thumbnail_url if camera else None,
                status="terkunci" if incidents else "tersimpan",
                storage_status="available",
                playback_url=segment.media_url,
            )
        )

    return recordings


def filter_recordings(
    recordings: list[Recording],
    *,
    has_incident: bool | None = None,
    recording_status: str | None = None,
    search: str | None = None,
    offset: int = 0,
    limit: int = 200,
) -> list[Recording]:
    result = recordings

    if has_incident is not None:
        result = [recording for recording in result if recording.has_incident == has_incident]

    if recording_status and recording_status != "all":
        result = [recording for recording in result if recording.status == recording_status]

    if search and search.strip():
        query = search.strip().lower()
        result = [
            recording
            for recording in result
            if query in recording.camera_name.lower()
            or query in recording.location.lower()
            or query in recording.id.lower()
        ]

    safe_offset = max(offset, 0)
    safe_limit = min(max(limit, 1), 500)
    return result[safe_offset : safe_offset + safe_limit]


def _incident_logs_for_segment(
    segment: RecordingSegment,
    camera_id: str,
    logs: list[BullyingLog],
) -> list[BullyingLog]:
    start_time = _ensure_aware(segment.start_time)
    end_time = _ensure_aware(segment.end_time)
    return [
        log
        for log in logs
        if log.camera_id == camera_id
        and start_time <= _ensure_aware(log.timestamp) <= end_time
    ]


def _ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value