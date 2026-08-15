from datetime import UTC, datetime
from hashlib import sha256
from typing import Any, cast
from uuid import uuid4

from sqlalchemy import and_, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reporting import (
    AlertModel,
    AlertReadReceiptModel,
    BullyingLogModel,
    EvidenceClipModel,
    IncidentReportModel,
)
from app.models.user import UserModel
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
    IncidentReport,
    IncidentReportUpdate,
    IncidentVerification,
    LogStatus,
    ReportStatus,
    TimelineEvent,
)


def utc_now() -> datetime:
    return datetime.now(UTC)


class IncidentVerificationConflictError(RuntimeError):
    pass


def to_bullying_log_schema(log: BullyingLogModel) -> BullyingLog:
    return BullyingLog(
        id=log.id,
        cameraId=log.camera_id,
        cameraName=log.camera_name,
        cameraLocation=log.camera_location,
        recordingId=log.recording_id,
        reportId=log.report_id,
        title=log.title,
        timestamp=log.timestamp,
        severity=cast(BullySeverity, log.severity),
        bullyType=cast(BullyType, log.bully_type),
        description=log.description,
        confidence=log.confidence,
        thumbnailUrl=log.thumbnail_url,
        status=cast(LogStatus, log.status),
        verificationStatus=cast(IncidentVerification, log.verification_status),
        verifiedBy=log.verified_by_name,
        verifiedAt=log.verified_at,
        pelapor=log.pelapor,
        terkaitRekaman=log.terkait_rekaman,
        timeline=_timeline_from_json(log.timeline),
    )


def to_alert_schema(alert: AlertModel, *, is_read: bool = False) -> Alert:
    return Alert(
        id=alert.id,
        type=cast(AlertType, alert.type),
        priority=cast(AlertPriority, alert.priority),
        cameraId=alert.camera_id,
        cameraName=alert.camera_name,
        title=alert.title,
        message=alert.message,
        timestamp=alert.timestamp,
        isRead=is_read,
        metadata=alert.metadata_json,
    )


def to_incident_report_schema(
    report: IncidentReportModel,
    log: BullyingLogModel,
) -> IncidentReport:
    return IncidentReport(
        id=report.id,
        logId=log.id,
        cameraId=log.camera_id,
        cameraName=log.camera_name,
        cameraLocation=log.camera_location,
        incidentAt=log.timestamp,
        confidence=log.confidence,
        aiReason=log.description,
        recordingId=log.recording_id,
        title=report.title,
        chronology=report.chronology,
        handlingNotes=report.handling_notes,
        status=cast(ReportStatus, report.status),
        createdBy=report.created_by_name,
        createdAt=report.created_at,
        updatedAt=report.updated_at,
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
    recording_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    search: str | None = None,
    verification_status: str | None = None,
) -> list[BullyingLog]:
    statement = select(BullyingLogModel).where(
        BullyingLogModel.bully_type == "physical"
    )

    if camera_id:
        statement = statement.where(BullyingLogModel.camera_id == camera_id)
    if severity:
        statement = statement.where(BullyingLogModel.severity == severity)
    if status and status != "all":
        statement = statement.where(BullyingLogModel.status == status)
    if recording_id:
        statement = statement.where(BullyingLogModel.recording_id == recording_id)
    if verification_status and verification_status != "all":
        statement = statement.where(
            BullyingLogModel.verification_status == verification_status
        )
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

    result = await session.execute(
        statement.order_by(
            BullyingLogModel.timestamp.desc(),
            BullyingLogModel.created_at.desc(),
            BullyingLogModel.id.desc(),
        )
    )
    return [to_bullying_log_schema(log) for log in result.scalars().all()]


async def get_bullying_log(session: AsyncSession, log_id: str) -> BullyingLog | None:
    model = await _get_bullying_log_model(session, log_id)
    return to_bullying_log_schema(model) if model else None


async def update_bullying_log_status(
    session: AsyncSession,
    log_id: str,
    status: LogStatus,
    editor: UserModel,
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
            description=f"Diperbarui oleh {editor.name} melalui halaman laporan",
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


async def update_bullying_log_verification(
    session: AsyncSession,
    log_id: str,
    verification: IncidentVerification,
    verifier: UserModel,
) -> BullyingLog | None:
    model = await _get_bullying_log_model(session, log_id, for_update=True)
    if not model:
        return None

    if model.verification_status == verification:
        if verification == "bullying" and not model.report_id:
            report = _create_report_model(model, verifier)
            model.report_id = report.id
            session.add(report)
            await session.commit()
            await session.refresh(model)
        return to_bullying_log_schema(model)
    if model.verification_status != "pending":
        raise IncidentVerificationConflictError(
            "Indikasi ini sudah memiliki hasil validasi final"
        )

    now = utc_now()
    timeline = _timeline_from_json(model.timeline)
    timeline = [
        TimelineEvent(
            title=item.title,
            description=item.description,
            timestamp=item.timestamp,
            status="completed" if item.status == "current" else item.status,
        )
        for item in timeline
    ]

    if verification == "bullying":
        model.status = "ditinjau"
        report = _create_report_model(model, verifier)
        model.report_id = report.id
        session.add(report)
        timeline.append(
            TimelineEvent(
                title="Dikonfirmasi sebagai bullying",
                description=f"Validasi dilakukan oleh {verifier.name}",
                timestamp=now,
                status="completed",
            )
        )
        timeline.append(
            TimelineEvent(
                title="Menunggu tindak lanjut",
                description="Laporan siap ditangani oleh pihak sekolah",
                timestamp=now,
                status="current",
            )
        )
    else:
        model.status = "selesai"
        timeline.append(
            TimelineEvent(
                title="Ditandai bukan bullying",
                description=(
                    f"Validasi dilakukan oleh {verifier.name}; "
                    "indikasi tetap disimpan sebagai riwayat"
                ),
                timestamp=now,
                status="completed",
            )
        )

    model.verification_status = verification
    model.verified_by_user_id = verifier.id
    model.verified_by_name = verifier.name
    model.verified_at = now
    model.timeline = _timeline_to_json(timeline)
    model.updated_at = now
    await session.commit()
    await session.refresh(model)
    return to_bullying_log_schema(model)


def _create_report_model(
    log: BullyingLogModel,
    creator: UserModel,
) -> IncidentReportModel:
    now = utc_now()
    return IncidentReportModel(
        id=f"report-{uuid4().hex[:12]}",
        log_id=log.id,
        title=log.title.replace("Indikasi", "Laporan", 1),
        chronology="",
        handling_notes="",
        status="draft",
        created_by_user_id=creator.id,
        created_by_name=creator.name,
        updated_by_user_id=creator.id,
        updated_by_name=creator.name,
        created_at=now,
        updated_at=now,
    )


async def list_alerts(
    session: AsyncSession,
    user: UserModel,
    *,
    unread_only: bool = False,
) -> list[Alert]:
    receipt_match = and_(
        AlertReadReceiptModel.alert_id == AlertModel.id,
        AlertReadReceiptModel.user_id == user.id,
    )
    statement = select(AlertModel, AlertReadReceiptModel.alert_id).outerjoin(
        AlertReadReceiptModel,
        receipt_match,
    )
    if user.role != "admin":
        statement = statement.where(AlertModel.audience.in_(("all", user.role)))
    if unread_only:
        statement = statement.where(AlertReadReceiptModel.alert_id.is_(None))

    result = await session.execute(
        statement.order_by(
            AlertModel.timestamp.desc(),
            AlertModel.created_at.desc(),
            AlertModel.id.desc(),
        )
    )
    return [
        to_alert_schema(alert, is_read=receipt_alert_id is not None)
        for alert, receipt_alert_id in result.all()
    ]


async def mark_alert_read(
    session: AsyncSession,
    alert_id: str,
    user: UserModel,
) -> Alert | None:
    model = await _get_alert_model_for_user(session, alert_id, user)
    if not model:
        return None

    receipt = await session.get(
        AlertReadReceiptModel,
        {"alert_id": alert_id, "user_id": user.id},
    )
    if receipt is None:
        session.add(
            AlertReadReceiptModel(
                alert_id=alert_id,
                user_id=user.id,
                read_at=utc_now(),
            )
        )
    await session.commit()
    return to_alert_schema(model, is_read=True)


async def mark_all_alerts_read(
    session: AsyncSession,
    user: UserModel,
) -> list[Alert]:
    unread_alerts = await list_alerts(session, user, unread_only=True)
    now = utc_now()
    for alert in unread_alerts:
        session.add(
            AlertReadReceiptModel(
                alert_id=alert.id,
                user_id=user.id,
                read_at=now,
            )
        )

    await session.commit()
    return await list_alerts(session, user)


async def list_incident_reports(
    session: AsyncSession,
    *,
    status: str | None = None,
) -> list[IncidentReport]:
    statement = (
        select(IncidentReportModel, BullyingLogModel)
        .join(BullyingLogModel, BullyingLogModel.id == IncidentReportModel.log_id)
        .where(
            BullyingLogModel.verification_status == "bullying",
            BullyingLogModel.bully_type == "physical",
        )
    )
    if status and status != "all":
        statement = statement.where(IncidentReportModel.status == status)
    result = await session.execute(
        statement.order_by(
            BullyingLogModel.timestamp.desc(),
            BullyingLogModel.created_at.desc(),
            BullyingLogModel.id.desc(),
        )
    )
    return [
        to_incident_report_schema(report, log)
        for report, log in result.all()
    ]


async def get_incident_report(
    session: AsyncSession,
    report_id: str,
) -> IncidentReport | None:
    pair = await _get_incident_report_models(session, report_id)
    if pair is None:
        return None
    report, log = pair
    return to_incident_report_schema(report, log)


async def update_incident_report(
    session: AsyncSession,
    report_id: str,
    payload: IncidentReportUpdate,
    editor: UserModel,
) -> IncidentReport | None:
    pair = await _get_incident_report_models(
        session,
        report_id,
        for_update=True,
    )
    if pair is None:
        return None

    report, log = pair
    changes = payload.model_dump(exclude_unset=True)
    if "title" in changes and changes["title"] is not None:
        report.title = changes["title"].strip()
    if "chronology" in changes and changes["chronology"] is not None:
        report.chronology = changes["chronology"].strip()
    if "handling_notes" in changes and changes["handling_notes"] is not None:
        report.handling_notes = changes["handling_notes"].strip()
    if "status" in changes and changes["status"] is not None:
        report.status = changes["status"]
        timeline = _timeline_from_json(log.timeline)
        timeline.append(
            TimelineEvent(
                title={
                    "draft": "Laporan disimpan sebagai draft",
                    "ditindaklanjuti": "Laporan mulai ditindaklanjuti",
                    "selesai": "Laporan selesai ditangani",
                }[report.status],
                description=f"Diperbarui oleh {editor.name}",
                timestamp=utc_now(),
                status="completed" if report.status == "selesai" else "current",
            )
        )
        log.timeline = _timeline_to_json(timeline)
        log.status = "selesai" if report.status == "selesai" else "ditinjau"
        log.updated_at = utc_now()

    report.updated_by_user_id = editor.id
    report.updated_by_name = editor.name
    report.updated_at = utc_now()
    await session.commit()
    await session.refresh(report)
    await session.refresh(log)
    return to_incident_report_schema(report, log)


async def list_evidence_clips(
    session: AsyncSession,
    recording_id: str | None = None,
) -> list[EvidenceClipResponse]:
    statement = select(EvidenceClipModel)
    if recording_id:
        statement = statement.where(EvidenceClipModel.recording_id == recording_id)

    result = await session.execute(statement.order_by(EvidenceClipModel.created_at.desc()))
    return [to_evidence_clip_schema(clip) for clip in result.scalars().all()]


async def get_evidence_clip(
    session: AsyncSession,
    clip_id: str,
) -> EvidenceClipResponse | None:
    model = await get_evidence_clip_model(session, clip_id)
    return to_evidence_clip_schema(model) if model else None


async def get_evidence_clip_model(
    session: AsyncSession,
    clip_id: str,
) -> EvidenceClipModel | None:
    result = await session.execute(
        select(EvidenceClipModel).where(EvidenceClipModel.id == clip_id)
    )
    return result.scalar_one_or_none()


async def list_pending_evidence_clip_ids(session: AsyncSession) -> list[str]:
    result = await session.execute(
        select(EvidenceClipModel.id).where(
            EvidenceClipModel.status.in_(("queued", "processing"))
        )
    )
    return list(result.scalars().all())


async def delete_expired_evidence_clip_models(
    session: AsyncSession,
    cutoff: datetime,
) -> list[str]:
    result = await session.execute(
        select(EvidenceClipModel).where(
            EvidenceClipModel.created_at <= cutoff,
            EvidenceClipModel.status.in_(("ready", "failed")),
        )
    )
    models = list(result.scalars().all())
    for model in models:
        await session.delete(model)
    if models:
        await session.commit()
    return [model.id for model in models]


async def update_evidence_clip_status(
    session: AsyncSession,
    clip_id: str,
    status: str,
    *,
    clip_url: str | None = None,
) -> EvidenceClipResponse | None:
    model = await get_evidence_clip_model(session, clip_id)
    if not model:
        return None

    model.status = status
    if clip_url is not None:
        model.clip_url = clip_url
    model.updated_at = utc_now()
    await session.commit()
    await session.refresh(model)
    return to_evidence_clip_schema(model)

async def queue_evidence_clip(
    session: AsyncSession,
    recording_id: str,
    request: EvidenceClipRequest,
) -> EvidenceClipResponse:
    clip_id = f"clip-{uuid4().hex[:8]}"
    clip = EvidenceClipModel(
        id=clip_id,
        recording_id=recording_id,
        camera_id=request.camera_id,
        start_time=request.start_time,
        end_time=request.end_time,
        reason=request.reason,
        clip_url=f"/api/recordings/clips/{clip_id}/media",
        status="queued",
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    session.add(clip)
    await session.commit()
    await session.refresh(clip)
    return to_evidence_clip_schema(clip)


async def _get_existing_incident_event(
    session: AsyncSession,
    log_id: str,
    alert_id: str,
) -> IncidentEventResult | None:
    log = await session.get(BullyingLogModel, log_id)
    alert = await session.get(AlertModel, alert_id)
    if log is None or alert is None:
        return None
    return IncidentEventResult(
        log=to_bullying_log_schema(log),
        alert=to_alert_schema(alert, is_read=False),
    )


def _incident_model_ids(event_id: str | None) -> tuple[str, str]:
    if not event_id:
        return f"log-{uuid4().hex[:8]}", f"alert-{uuid4().hex[:8]}"
    digest = sha256(event_id.encode("utf-8")).hexdigest()[:24]
    return f"log-event-{digest}", f"alert-event-{digest}"


async def create_incident_event(
    session: AsyncSession,
    payload: IncidentEventCreate,
) -> tuple[IncidentEventResult, bool]:
    detected_at = payload.occurred_at or utc_now()
    log_id, alert_id = _incident_model_ids(payload.event_id)
    if payload.event_id:
        existing = await _get_existing_incident_event(session, log_id, alert_id)
        if existing is not None:
            return existing, False
    camera = await get_camera(session, payload.camera_id)
    camera_name = camera.name if camera else payload.camera_name
    camera_location = camera.location if camera else "-"
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
            title="Menunggu validasi",
            description="Admin sekolah atau Guru BK perlu memastikan indikasi ini benar-benar bullying",
            timestamp=detected_at,
            status="current",
        ),
    ]

    log = BullyingLogModel(
        id=log_id,
        camera_id=payload.camera_id,
        camera_name=camera_name,
        camera_location=camera_location,
        recording_id=payload.recording_id,
        report_id=None,
        title="Indikasi bullying fisik",
        timestamp=detected_at,
        severity=payload.severity,
        bully_type=payload.bully_type,
        description=payload.description,
        confidence=payload.confidence,
        thumbnail_url=payload.thumbnail_url,
        status=log_status,
        verification_status="pending",
        verified_by_user_id=None,
        verified_by_name=None,
        verified_at=None,
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
        title="Indikasi Bullying Perlu Validasi",
        message=(
            "Sistem menerima indikasi bullying fisik. "
            "Periksa lalu pilih Bullying atau Bukan Bullying. "
            f"Confidence: {round(payload.confidence * 100)}%"
        ),
        timestamp=detected_at,
        is_read=False,
        audience="all",
        metadata_json={
            "confidence": payload.confidence,
            "eventId": payload.event_id,
            "logId": log_id,
            "recordingId": payload.recording_id,
        },
        created_at=utc_now(),
        updated_at=utc_now(),
    )

    session.add_all([log, alert])
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        if payload.event_id:
            existing = await _get_existing_incident_event(session, log_id, alert_id)
            if existing is not None:
                return existing, False
        raise
    except Exception:
        await session.rollback()
        raise

    await session.refresh(log)
    await session.refresh(alert)
    return (
        IncidentEventResult(
            log=to_bullying_log_schema(log),
            alert=to_alert_schema(alert, is_read=False),
        ),
        True,
    )


async def _get_bullying_log_model(
    session: AsyncSession,
    log_id: str,
    *,
    for_update: bool = False,
) -> BullyingLogModel | None:
    statement = select(BullyingLogModel).where(
        BullyingLogModel.id == log_id,
        BullyingLogModel.bully_type == "physical",
    )
    if for_update:
        statement = statement.with_for_update()
    result = await session.execute(statement)
    return result.scalar_one_or_none()


async def _get_alert_model(session: AsyncSession, alert_id: str) -> AlertModel | None:
    result = await session.execute(select(AlertModel).where(AlertModel.id == alert_id))
    return result.scalar_one_or_none()


async def _get_alert_model_for_user(
    session: AsyncSession,
    alert_id: str,
    user: UserModel,
) -> AlertModel | None:
    statement = select(AlertModel).where(AlertModel.id == alert_id)
    if user.role != "admin":
        statement = statement.where(AlertModel.audience.in_(("all", user.role)))
    result = await session.execute(statement)
    return result.scalar_one_or_none()


async def _get_incident_report_models(
    session: AsyncSession,
    report_id: str,
    *,
    for_update: bool = False,
) -> tuple[IncidentReportModel, BullyingLogModel] | None:
    statement = (
        select(IncidentReportModel, BullyingLogModel)
        .join(BullyingLogModel, BullyingLogModel.id == IncidentReportModel.log_id)
        .where(
            IncidentReportModel.id == report_id,
            BullyingLogModel.bully_type == "physical",
        )
    )
    if for_update:
        statement = statement.with_for_update()
    result = await session.execute(statement)
    row = result.first()
    if row is None:
        return None
    return row[0], row[1]


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
