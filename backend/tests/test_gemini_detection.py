import asyncio
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest

from app.core.config import Settings
from app.schemas import Camera, IncidentEventCreate
from app.services.gemini_classifier import GeminiClassification
from app.workers.gemini_detection import (
    _LOCAL_INCIDENT_COOLDOWNS,
    _LOCAL_INCIDENT_PENDING,
    CapturedClip,
    _claim_incident_delivery,
    _complete_incident_delivery,
    _post_incident,
    _release_incident_delivery,
    build_capture_command,
    build_incident_event_id,
    severity_for_confidence,
    should_emit_prediction,
    validate_detection_settings,
)


def _camera() -> Camera:
    return Camera(
        id="cam-test",
        name="Koridor",
        location="Gedung A",
        status="online",
        mediaPath="camera-test",
        sourceType="hls",
        lastActive=datetime.now(UTC),
        isAiEnabled=True,
    )


def test_capture_command_reads_camera_from_mediamtx():
    settings = Settings(
        _env_file=None,
        ai_detection_rtsp_base_url="rtsp://mediamtx:8554",
        ai_detection_clip_seconds=3,
        gemini_video_fps=7.5,
    )

    command = build_capture_command(_camera(), settings, Path("/tmp/clip.mp4"))

    assert command[command.index("-i") + 1] == (
        "rtsp://mediamtx:8554/camera-test"
    )
    assert command[command.index("-t") + 1] == "3"
    assert command[command.index("-vf") + 1] == "fps=7.5,scale=640:-2"
    assert command[command.index("-timeout") + 1] == "8000000"
    assert "-rw_timeout" not in command


def test_only_confident_bullying_creates_incident():
    result = GeminiClassification(
        observasi_gerakan="Terlihat dorongan.",
        analisis_kontak_fisik="Kontak sepihak.",
        confidence=0.84,
        prediction="bullying",
        reason="Kontak fisik agresif.",
    )

    assert should_emit_prediction(result, 0.75)
    assert not should_emit_prediction(result, 0.9)
    assert severity_for_confidence(0.84) == "medium"
    assert severity_for_confidence(0.9) == "high"
    assert severity_for_confidence(0.97) == "critical"


def test_production_detection_requires_incident_ingest_token() -> None:
    settings = Settings(
        _env_file=None,
        environment="production",
        ai_detection_enabled=True,
        gemini_api_key="test-key",
        incident_ingest_token="",
    )

    with pytest.raises(RuntimeError, match="INCIDENT_INGEST_TOKEN kosong"):
        validate_detection_settings(settings)

    settings.incident_ingest_token = "test-ingest-token"
    validate_detection_settings(settings)


def test_incident_event_id_is_stable_for_the_same_clip() -> None:
    clip = CapturedClip(
        camera=_camera(),
        path=Path("/tmp/clip.mp4"),
        occurred_at=datetime(2026, 8, 2, 8, 30, tzinfo=UTC),
    )

    first = build_incident_event_id(clip, b"same-video")
    second = build_incident_event_id(clip, b"same-video")
    different = build_incident_event_id(clip, b"different-video")

    assert first == second
    assert first != different
    assert first.startswith("gemini-")


def test_incident_post_retries_with_the_same_idempotency_key() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        status_code = 503 if len(requests) == 1 else 201
        return httpx.Response(status_code, request=request)

    async def scenario() -> None:
        settings = Settings(
            _env_file=None,
            incident_api_base_url="http://api.test/api",
            incident_request_max_attempts=3,
            incident_request_retry_base_seconds=0.01,
        )
        payload = IncidentEventCreate(
            eventId="gemini-test-event",
            cameraId="cam-test",
            cameraName="Koridor",
            bullyType="physical",
            severity="high",
            confidence=0.91,
            description="Kontak fisik agresif.",
        )
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            await _post_incident(client, payload, settings)

    asyncio.run(scenario())

    assert len(requests) == 2
    assert {request.headers["Idempotency-Key"] for request in requests} == {
        "gemini-test-event"
    }


def test_failed_delivery_releases_slot_and_success_starts_cooldown() -> None:
    async def scenario() -> None:
        _LOCAL_INCIDENT_PENDING.clear()
        _LOCAL_INCIDENT_COOLDOWNS.clear()
        redis = FakeRedis()
        settings = Settings(
            _env_file=None,
            ai_detection_cooldown_seconds=30,
        )

        failed_lease = await _claim_incident_delivery(
            redis, "cam-test", settings
        )
        assert failed_lease is not None
        await _release_incident_delivery(redis, failed_lease)

        retry_lease = await _claim_incident_delivery(
            redis, "cam-test", settings
        )
        assert retry_lease is not None
        await _complete_incident_delivery(redis, retry_lease, settings)

        assert (
            await _claim_incident_delivery(redis, "cam-test", settings)
            is None
        )
        _LOCAL_INCIDENT_PENDING.clear()
        _LOCAL_INCIDENT_COOLDOWNS.clear()

    asyncio.run(scenario())


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    async def exists(self, key: str) -> int:
        return int(key in self.values)

    async def set(
        self,
        key: str,
        value: str,
        *,
        ex: int,
        nx: bool = False,
    ) -> bool:
        if nx and key in self.values:
            return False
        self.values[key] = value
        return True

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def delete(self, key: str) -> int:
        return int(self.values.pop(key, None) is not None)
