from datetime import UTC, datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.recording import RecordingModel
from app.schemas import Recording


def utc_now() -> datetime:
    return datetime.now(UTC)


async def list_ready_recording_models(
    session: AsyncSession,
    *,
    camera_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[RecordingModel]:
    now = utc_now()
    statement = select(RecordingModel).where(
        RecordingModel.archive_status == "ready",
        or_(RecordingModel.expires_at.is_(None), RecordingModel.expires_at > now),
    )
    if camera_id:
        statement = statement.where(RecordingModel.camera_id == camera_id)
    if date_from:
        statement = statement.where(RecordingModel.end_time >= _aware(date_from))
    if date_to:
        statement = statement.where(RecordingModel.start_time <= _aware(date_to))

    result = await session.execute(statement.order_by(RecordingModel.start_time.desc()))
    return list(result.scalars().all())


async def get_recording_model(
    session: AsyncSession,
    recording_id: str,
    *,
    ready_only: bool = False,
) -> RecordingModel | None:
    statement = select(RecordingModel).where(RecordingModel.id == recording_id)
    if ready_only:
        now = utc_now()
        statement = statement.where(
            RecordingModel.archive_status == "ready",
            or_(RecordingModel.expires_at.is_(None), RecordingModel.expires_at > now),
        )
    result = await session.execute(statement)
    return result.scalar_one_or_none()


async def reserve_recording_archive(
    session: AsyncSession,
    *,
    recording_id: str,
    camera_id: str,
    media_path: str,
    camera_name: str,
    location: str,
    start_time: datetime,
    end_time: datetime,
    duration_seconds: int,
    source_segment_count: int,
) -> RecordingModel:
    model = await get_recording_model(session, recording_id)
    now = utc_now()
    if model is None:
        model = RecordingModel(
            id=recording_id,
            camera_id=camera_id,
            media_path=media_path,
            camera_name=camera_name,
            location=location,
            start_time=_aware(start_time),
            end_time=_aware(end_time),
            duration_seconds=duration_seconds,
            file_path=None,
            file_size=0,
            source_segment_count=source_segment_count,
            archive_status="processing",
            recording_status="tersimpan",
            failure_reason=None,
            available_at=None,
            expires_at=None,
            created_at=now,
            updated_at=now,
        )
        session.add(model)
    else:
        model.camera_name = camera_name
        model.location = location
        model.media_path = media_path
        model.end_time = _aware(end_time)
        model.duration_seconds = duration_seconds
        model.source_segment_count = source_segment_count
        model.archive_status = "processing"
        model.failure_reason = None
        model.updated_at = now

    await session.commit()
    await session.refresh(model)
    return model


async def mark_recording_ready(
    session: AsyncSession,
    recording_id: str,
    *,
    file_path: str,
    file_size: int,
    duration_seconds: int,
    available_at: datetime,
    expires_at: datetime,
) -> RecordingModel | None:
    model = await get_recording_model(session, recording_id)
    if model is None:
        return None
    model.file_path = file_path
    model.file_size = file_size
    model.duration_seconds = max(1, duration_seconds)
    model.end_time = model.start_time + timedelta(seconds=model.duration_seconds)
    model.archive_status = "ready"
    model.failure_reason = None
    model.available_at = _aware(available_at)
    model.expires_at = _aware(expires_at)
    model.updated_at = utc_now()
    await session.commit()
    await session.refresh(model)
    return model


async def mark_recording_failed(
    session: AsyncSession,
    recording_id: str,
    reason: str,
) -> None:
    model = await get_recording_model(session, recording_id)
    if model is None:
        return
    model.archive_status = "failed"
    model.failure_reason = reason[-4000:]
    model.updated_at = utc_now()
    await session.commit()


async def list_expired_recording_models(
    session: AsyncSession,
    *,
    now: datetime | None = None,
) -> list[RecordingModel]:
    cutoff = _aware(now or utc_now())
    result = await session.execute(
        select(RecordingModel).where(
            RecordingModel.expires_at.is_not(None),
            RecordingModel.expires_at <= cutoff,
        )
    )
    return list(result.scalars().all())


async def delete_recording_model(
    session: AsyncSession,
    model: RecordingModel,
) -> None:
    await session.delete(model)
    await session.commit()


def to_recording_schema(
    model: RecordingModel,
    *,
    incident_count: int,
    file_available: bool,
) -> Recording:
    media_url = f"/api/recordings/{model.id}/media" if file_available else None
    return Recording(
        id=model.id,
        cameraId=model.camera_id,
        cameraName=model.camera_name,
        location=model.location,
        startTime=model.start_time,
        endTime=model.end_time,
        duration=model.duration_seconds,
        fileUrl=media_url,
        fileSize=model.file_size,
        hasIncident=incident_count > 0,
        incidentCount=incident_count,
        thumbnailUrl=None,
        status="terkunci" if incident_count > 0 else model.recording_status,
        storageStatus="available" if file_available else "unavailable",
        playbackUrl=media_url,
        availableAt=model.available_at,
        expiresAt=model.expires_at,
    )


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
