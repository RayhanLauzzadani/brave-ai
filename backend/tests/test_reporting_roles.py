import asyncio
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.models.reporting import (
    AlertModel,
    AlertReadReceiptModel,
    BullyingLogModel,
    IncidentReportModel,
)
from app.models.user import UserModel
from app.repositories.reporting import (
    create_incident_event,
    mark_alert_read,
    update_bullying_log_verification,
)
from app.schemas import IncidentEventCreate


def make_user(user_id: str, role: str = "viewer") -> UserModel:
    now = datetime.now(UTC)
    return UserModel(
        id=user_id,
        name=f"User {user_id}",
        email=f"{user_id}@example.test",
        password_hash="unused",
        role=role,
        avatar=None,
        created_at=now,
        updated_at=now,
    )


def make_alert() -> AlertModel:
    now = datetime.now(UTC)
    return AlertModel(
        id="alert-test",
        type="bullying_detected",
        priority="high",
        camera_id="camera-test",
        camera_name="Kamera Test",
        title="Indikasi baru",
        message="Perlu diperiksa",
        timestamp=now,
        is_read=False,
        audience="viewer",
        metadata_json={"logId": "log-test"},
        created_at=now,
        updated_at=now,
    )


def make_log() -> BullyingLogModel:
    now = datetime.now(UTC)
    return BullyingLogModel(
        id="log-test",
        camera_id="camera-test",
        camera_name="Kamera Test",
        camera_location="Koridor",
        recording_id="recording-test",
        report_id=None,
        title="Indikasi bullying fisik",
        timestamp=now,
        severity="high",
        bully_type="physical",
        description="Kontak fisik terdeteksi.",
        confidence=0.91,
        thumbnail_url=None,
        status="prioritas-tinggi",
        verification_status="pending",
        verified_by_user_id=None,
        verified_by_name=None,
        verified_at=None,
        pelapor="Sistem",
        terkait_rekaman="Kamera Test / recording-test",
        timeline=[
            {
                "title": "Menunggu validasi",
                "description": "Perlu diperiksa Guru BK",
                "timestamp": now.isoformat(),
                "status": "current",
            }
        ],
        created_at=now,
        updated_at=now,
    )


def test_alert_read_receipt_is_independent_for_each_user() -> None:
    session = FakeAlertSession(make_alert())
    first_user = make_user("viewer-one")
    second_user = make_user("viewer-two")

    first_result = asyncio.run(
        mark_alert_read(session, "alert-test", first_user)
    )
    asyncio.run(mark_alert_read(session, "alert-test", first_user))
    second_result = asyncio.run(
        mark_alert_read(session, "alert-test", second_user)
    )

    assert first_result is not None and first_result.is_read is True
    assert second_result is not None and second_result.is_read is True
    assert set(session.receipts) == {
        ("alert-test", "viewer-one"),
        ("alert-test", "viewer-two"),
    }


def test_confirming_bullying_creates_exactly_one_report() -> None:
    log = make_log()
    session = FakeVerificationSession(log)
    viewer = make_user("viewer-one")

    first = asyncio.run(
        update_bullying_log_verification(
            session,
            log.id,
            "bullying",
            viewer,
        )
    )
    second = asyncio.run(
        update_bullying_log_verification(
            session,
            log.id,
            "bullying",
            viewer,
        )
    )

    assert first is not None and first.report_id is not None
    assert second is not None and second.report_id == first.report_id
    assert first.verified_by == viewer.name
    assert len(session.reports) == 1


def test_rejecting_indication_keeps_history_without_report() -> None:
    log = make_log()
    session = FakeVerificationSession(log)
    viewer = make_user("viewer-one")

    result = asyncio.run(
        update_bullying_log_verification(
            session,
            log.id,
            "not-bullying",
            viewer,
        )
    )

    assert result is not None
    assert result.verification_status == "not-bullying"
    assert result.report_id is None
    assert session.reports == []


def test_incident_event_id_is_idempotent() -> None:
    session = FakeIncidentSession()
    payload = IncidentEventCreate(
        eventId="gemini-camera-test-incident-001",
        cameraId="camera-test",
        cameraName="Kamera Test",
        bullyType="physical",
        severity="high",
        confidence=0.91,
        description="Kontak fisik agresif.",
    )

    first, first_created = asyncio.run(create_incident_event(session, payload))
    second, second_created = asyncio.run(create_incident_event(session, payload))

    assert first_created is True
    assert second_created is False
    assert second.log.id == first.log.id
    assert second.alert.id == first.alert.id
    assert len(session.values) == 2


def test_incident_event_rejects_non_physical_bullying() -> None:
    with pytest.raises(ValidationError):
        IncidentEventCreate(
            cameraId="camera-test",
            cameraName="Kamera Test",
            bullyType="verbal",
            severity="high",
            confidence=0.91,
            description="Tipe kejadian di luar scope MVP.",
        )


class ScalarResult:
    def __init__(self, value: object) -> None:
        self.value = value

    def scalar_one_or_none(self) -> object:
        return self.value


class FakeAlertSession:
    def __init__(self, alert: AlertModel) -> None:
        self.alert = alert
        self.receipts: dict[
            tuple[str, str],
            AlertReadReceiptModel,
        ] = {}

    async def execute(self, _statement: object) -> ScalarResult:
        return ScalarResult(self.alert)

    async def get(
        self,
        _model: type[AlertReadReceiptModel],
        key: dict[str, str],
    ) -> AlertReadReceiptModel | None:
        return self.receipts.get((key["alert_id"], key["user_id"]))

    def add(self, value: AlertReadReceiptModel) -> None:
        self.receipts[(value.alert_id, value.user_id)] = value

    async def commit(self) -> None:
        return None


class FakeVerificationSession:
    def __init__(self, log: BullyingLogModel) -> None:
        self.log = log
        self.reports: list[IncidentReportModel] = []

    async def execute(self, _statement: object) -> ScalarResult:
        return ScalarResult(self.log)

    def add(self, value: IncidentReportModel) -> None:
        self.reports.append(value)

    async def commit(self) -> None:
        return None

    async def refresh(self, _value: object) -> None:
        return None


class FakeIncidentSession:
    def __init__(self) -> None:
        self.values: dict[tuple[type[object], str], object] = {}

    async def execute(self, _statement: object) -> ScalarResult:
        return ScalarResult(None)

    async def get(self, model: type[object], value_id: str) -> object | None:
        return self.values.get((model, value_id))

    def add_all(self, values: list[object]) -> None:
        for value in values:
            self.values[(type(value), value.id)] = value

    async def commit(self) -> None:
        return None

    async def rollback(self) -> None:
        return None

    async def refresh(self, _value: object) -> None:
        return None
