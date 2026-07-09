from datetime import UTC, datetime
from typing import Any, cast
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reporting import AlertModel, BullyingLogModel, EvidenceClipModel
from app.repositories.cameras import get_camera
from app.schemas import (
    Alert,
    AlertPriority,
    AlertType,
    BullyingLog,
    BullySeverity,
    BullyType,
    EvidenceClipRequest,
    EvidenceClipResponse,
    IncidentEventCreate,
    IncidentEventResult,
    LogStatus,
    TimelineEvent,
    TimelineStatus,
)


def utc_now() -> datetime:
    return datetime.now(UTC)


def to_bullying_log_schema(log: BullyingLogModel) -> BullyingLog:
    return BullyingLog(
        id=log.id,
        cameraId=log.camera_id,
        cameraName=log.camera_name,
        recordingId=log.recording_id,
        title=log.title,
        timestamp=log.timestamp,
        severity=cast(BullySeverity, log.severity),
        bullyType=cast(BullyType, log.bully_type),
        description=log.description,
        confidence=log.confidence,
        thumbnailUrl=log.thumbnail_url,
        status=cast(LogStatus, log.status),
        pelapor=log.pelapor,
        terkaitRekaman=log.terkait_rekaman,
        timeline=_timeline_from_json(log.timeline),
    )


def to_alert_schema(alert: AlertModel) -> Alert:
    return Alert(
        id=alert.id,
        type=cast(AlertType, alert.type),
        priority=cast(AlertPriority, alert.priority),
        cameraId=alert.camera_id,
        cameraName=alert.camera_name,
        title=alert.title,
        message=alert.message,
        timestamp=alert.timestamp,
        isRead=alert.is_read,
        metadata=alert.metadata_json,
    )


def to_evidence_clip_schema(clip: EvidenceClipModel) -> EvidenceClipResponse:
    return EvidenceClipResponse(
        id=clip.id,
        recordingId=clip.recording_id,
        cameraId=clip.camera_id,
        startTime=clip.start_time,
        endTime=clip.end_time,
        reason=clip.reason,
        clipUrl=clip.clip_url,
        status=cast(Any, clip.status),
        createdAt=clip.created_at,
    )


async def list_bullying_logs(
    session: AsyncSession,
    *,
    camera_id: str | None = None,
    severity: str | None = None,
    status: str | None = None,
    bully_type: str | None = None,
    recording_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    search: str | None = None,
) -> list[BullyingLog]:
    statement = select(BullyingLogModel)

    if camera_id:
        statement = statement.where(BullyingLogModel.camera_id == camera_id)
    if severity:
        statement = statement.where(BullyingLogModel.severity == severity)
    if status and status != "all":
        statement = statement.where(BullyingLogModel.status == status)
    if bully_type and bully_type != "all":
        statement = statement.where(BullyingLogModel.bully_type == bully_type)
    if recording_id:
        statement = statement.where(BullyingLogModel.recording_id == recording_id)
    if date_from:
        statement = statement.where(BullyingLogModel.timestamp >= _ensure_aware(date_from))
    if date_to:
        statement = statement.where(BullyingLogModel.timestamp <= _ensure_aware(date_to))
    if search:
        pattern = f"%{search.lower().strip()}%"
        statement = statement.where(
            or_(
                BullyingLogModel.id.ilike(pattern),
                BullyingLogModel.title.ilike(pattern),
                BullyingLogModel.camera_name.ilike(pattern),
                BullyingLogModel.description.ilike(pattern),
                BullyingLogModel.terkait_rekaman.ilike(pattern),
                BullyingLogModel.recording_id.ilike(pattern),
            )
        )

    result = await session.execute(statement.order_by(BullyingLogModel.timestamp.desc()))
    return [to_bullying_log_schema(log) for log in result.scalars().all()]


async def get_bullying_log(session: AsyncSession, log_id: str) -> BullyingLog | None:
    model = await _get_bullying_log_model(session, log_id)
    return to_bullying_log_schema(model) if model else None


async def update_bullying_log_status(
    session: AsyncSession,
    log_id: str,
    status: LogStatus,
) -> BullyingLog | None:
    model = await _get_bullying_log_model(session, log_id)
    if not model:
        return None

    status_titles = {
        "dalam-proses": "Status dikembalikan ke proses",
        "ditinjau": "Bukti sedang ditinjau",
        "selesai": "Laporan selesai ditangani",
        "prioritas-tinggi": "Laporan diprioritaskan",
    }
    timeline = _timeline_from_json(model.timeline)
    timeline.append(
        TimelineEvent(
            title=status_titles.get(status, "Status diperbarui"),
            description="oleh pengawas melalui halaman laporan",
            timestamp=utc_now(),
            status="completed" if status == "selesai" else "current",
        )
    )

    model.status = status
    model.timeline = _timeline_to_json(timeline)
    model.updated_at = utc_now()
    await session.commit()
    await session.refresh(model)
    return to_bullying_log_schema(model)


async def list_alerts(session: AsyncSession, *, unread_only: bool = False) -> list[Alert]:
    statement = select(AlertModel)
    if unread_only:
        statement = statement.where(AlertModel.is_read.is_(False))

    result = await session.execute(statement.order_by(AlertModel.timestamp.desc()))
    return [to_alert_schema(alert) for alert in result.scalars().all()]


async def mark_alert_read(session: AsyncSession, alert_id: str) -> Alert | None:
    model = await _get_alert_model(session, alert_id)
    if not model:
        return None

    model.is_read = True
    model.updated_at = utc_now()
    await session.commit()
    await session.refresh(model)
    return to_alert_schema(model)


async def mark_all_alerts_read(session: AsyncSession) -> list[Alert]:
    result = await session.execute(
        select(AlertModel).where(AlertModel.is_read.is_(False))
    )
    for alert in result.scalars().all():
        alert.is_read = True
        alert.updated_at = utc_now()

    await session.commit()
    return await list_alerts(session)


async def list_evidence_clips(
    session: AsyncSession,
    recording_id: str | None = None,
) -> list[EvidenceClipResponse]:
    statement = select(EvidenceClipModel)
    if recording_id:
        statement = statement.where(EvidenceClipModel.recording_id == recording_id)

    result = await session.execute(statement.order_by(EvidenceClipModel.created_at.desc()))
    return [to_evidence_clip_schema(clip) for clip in result.scalars().all()]


async def queue_evidence_clip(
    session: AsyncSession,
    recording_id: str,
    request: EvidenceClipRequest,
) -> EvidenceClipResponse:
    clip = EvidenceClipModel(
        id=f"clip-{uuid4().hex[:8]}",
        recording_id=recording_id,
        camera_id=request.camera_id,
        start_time=request.start_time,
        end_time=request.end_time,
        reason=request.reason,
        clip_url=f"/media/clips/{recording_id}-{uuid4().hex[:6]}.mp4",
        status="queued",
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    session.add(clip)
    await session.commit()
    await session.refresh(clip)
    return to_evidence_clip_schema(clip)


async def create_incident_event(
    session: AsyncSession,
    payload: IncidentEventCreate,
) -> IncidentEventResult:
    detected_at = payload.occurred_at or utc_now()
    log_id = f"log-{uuid4().hex[:8]}"
    alert_id = f"alert-{uuid4().hex[:8]}"
    camera = await get_camera(session, payload.camera_id)
    camera_name = camera.name if camera else payload.camera_name
    priority = "critical" if payload.severity == "critical" else "high"
    log_status = (
        "prioritas-tinggi"
        if payload.severity in {"high", "critical"}
        else "dalam-proses"
    )
    timeline = [
        TimelineEvent(
            title="Event diterima backend",
            description="dari service deteksi eksternal",
            timestamp=detected_at,
            status="completed",
        ),
        TimelineEvent(
            title="Menunggu penanganan",
            description="Pengawas perlu meninjau bukti dan menindaklanjuti",
            timestamp=detected_at,
            status="current",
        ),
    ]

    log = BullyingLogModel(
        id=log_id,
        camera_id=payload.camera_id,
        camera_name=camera_name,
        recording_id=payload.recording_id,
        title=f"Indikasi {payload.bully_type} bullying",
        timestamp=detected_at,
        severity=payload.severity,
        bully_type=payload.bully_type,
        description=payload.description,
        confidence=payload.confidence,
        thumbnail_url=payload.thumbnail_url,
        status=log_status,
        pelapor="Sistem Deteksi Eksternal",
        terkait_rekaman=f"{camera_name} / {payload.recording_id or 'rekaman berjalan'}",
        timeline=_timeline_to_json(timeline),
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    alert = AlertModel(
        id=alert_id,
        type="bullying_detected",
        priority=priority,
        camera_id=payload.camera_id,
        camera_name=camera_name,
        title="Indikasi Bullying Diterima",
        message=(
            f"Backend menerima indikasi {payload.bully_type} bullying. "
            f"Confidence: {round(payload.confidence * 100)}%"
        ),
        timestamp=detected_at,
        is_read=False,
        metadata_json={
            "confidence": payload.confidence,
            "logId": log_id,
            "recordingId": payload.recording_id,
        },
        created_at=utc_now(),
        updated_at=utc_now(),
    )

    session.add_all([log, alert])
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        raise

    await session.refresh(log)
    await session.refresh(alert)
    return IncidentEventResult(
        log=to_bullying_log_schema(log),
        alert=to_alert_schema(alert),
    )


async def _get_bullying_log_model(
    session: AsyncSession,
    log_id: str,
) -> BullyingLogModel | None:
    result = await session.execute(
        select(BullyingLogModel).where(BullyingLogModel.id == log_id)
    )
    return result.scalar_one_or_none()


async def _get_alert_model(session: AsyncSession, alert_id: str) -> AlertModel | None:
    result = await session.execute(select(AlertModel).where(AlertModel.id == alert_id))
    return result.scalar_one_or_none()


def _timeline_from_json(items: list[dict[str, Any]] | None) -> list[TimelineEvent]:
    if not items:
        return []
    return [TimelineEvent.model_validate(item) for item in items]


def _timeline_to_json(items: list[TimelineEvent]) -> list[dict[str, Any]]:
    return [item.model_dump(mode="json") for item in items]


def _ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value