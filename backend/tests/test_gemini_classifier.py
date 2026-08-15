import asyncio
import base64
import json
from datetime import UTC, datetime

import httpx
import pytest

from app.core.config import Settings
from app.services.gemini_classifier import (
    GeminiClassification,
    GeminiClassifierError,
    GeminiVideoClassifier,
    _validate_classification,
    build_incident_report,
)


def _settings() -> Settings:
    return Settings(
        _env_file=None,
        gemini_api_key="test-key",
        gemini_model_name="gemini-3.1-flash-lite",
        gemini_max_retries=0,
        gemini_video_fps=10,
    )


def test_classifier_sends_video_and_parses_structured_result():
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        captured["payload"] = json.loads(request.content)
        result = {
            "ruangan_kosong": False,
            "jumlah_subjek": 2,
            "jenis_kontak": "dorongan",
            "ada_kontak_antar_subjek": True,
            "kronologi_kejadian": "Satu siswa mendorong siswa lain.",
            "detik_mulai_kontak": 1.25,
            "confidence": 0.91,
            "prediction": "bullying",
            "reason": "Terdapat kontak fisik agresif.",
        }
        return httpx.Response(
            200,
            json={
                "candidates": [
                    {"content": {"parts": [{"text": json.dumps(result)}]}}
                ]
            },
        )

    async def classify():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            classifier = GeminiVideoClassifier(_settings(), client)
            return await classifier.classify(
                b"fake-mp4",
                clip_duration_seconds=3,
            )

    result = asyncio.run(classify())
    request = captured["request"]
    payload = captured["payload"]

    assert isinstance(request, httpx.Request)
    assert isinstance(payload, dict)
    assert request.headers["x-goog-api-key"] == "test-key"
    assert request.url.path.endswith(
        "/models/gemini-3.1-flash-lite:generateContent"
    )
    video_part = payload["contents"][0]["parts"][0]
    assert base64.b64decode(video_part["inlineData"]["data"]) == b"fake-mp4"
    assert video_part["videoMetadata"]["fps"] == 10
    assert payload["generationConfig"]["responseMimeType"] == "application/json"
    assert result.prediction == "bullying"
    assert result.confidence == 0.91
    assert result.jumlah_subjek == 2
    assert result.detik_mulai_kontak == 1.25


def test_classifier_rejects_response_without_candidate():
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"promptFeedback": {"blockReason": "SAFETY"}},
        )

    async def classify():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            classifier = GeminiVideoClassifier(_settings(), client)
            return await classifier.classify(b"fake-mp4")

    with pytest.raises(GeminiClassifierError, match="SAFETY"):
        asyncio.run(classify())


def test_hallucination_guard_rejects_single_subject_bullying():
    result = _validate_classification(
        {
            "ruangan_kosong": False,
            "jumlah_subjek": 1,
            "jenis_kontak": "pukulan",
            "ada_kontak_antar_subjek": True,
            "kronologi_kejadian": "Satu orang meninju ke arah udara.",
            "detik_mulai_kontak": 1.0,
            "confidence": 0.95,
            "prediction": "bullying",
            "reason": "Gerakan tangan terlihat cepat.",
        },
        max_contact_second=3,
    )

    assert result.prediction == "non-bullying"
    assert result.detik_mulai_kontak is None
    assert "Auto-koreksi" in result.reason


def test_hallucination_guard_rejects_contact_outside_clip():
    result = _validate_classification(
        {
            "ruangan_kosong": False,
            "jumlah_subjek": 2,
            "jenis_kontak": "dorongan",
            "ada_kontak_antar_subjek": True,
            "kronologi_kejadian": "Dua orang berada di koridor.",
            "detik_mulai_kontak": 9.0,
            "confidence": 0.9,
            "prediction": "bullying",
            "reason": "Kontak dilaporkan di luar durasi klip.",
        },
        max_contact_second=3,
    )

    assert result.prediction == "non-bullying"
    assert result.detik_mulai_kontak is None


def test_incident_report_uses_contact_offset_and_wib_display():
    classification = GeminiClassification(
        ruangan_kosong=False,
        jumlah_subjek=2,
        jenis_kontak="dorongan",
        ada_kontak_antar_subjek=True,
        kronologi_kejadian="Satu siswa mendorong siswa lainnya.",
        detik_mulai_kontak=1.5,
        confidence=0.9,
        prediction="bullying",
        reason="Dorongan terlihat jelas.",
    )
    clip_started_at = datetime(2026, 8, 13, 1, 0, tzinfo=UTC)

    report = build_incident_report(
        classification,
        clip_started_at=clip_started_at,
    )

    assert report.waktu_kejadian == datetime(
        2026,
        8,
        13,
        1,
        0,
        1,
        500000,
        tzinfo=UTC,
    )
    assert "08:00:01 WIB" in report.alasan
    assert report.raw is classification


def test_hallucination_guard_rejects_friendly_contact():
    result = _validate_classification(
        {
            "ruangan_kosong": False,
            "jumlah_subjek": 2,
            "jenis_kontak": "tepukan_ringan_bersahabat",
            "ada_kontak_antar_subjek": True,
            "kronologi_kejadian": "Satu siswa menepuk bahu temannya.",
            "detik_mulai_kontak": 1.0,
            "confidence": 0.95,
            "prediction": "bullying",
            "reason": "Tangan menyentuh bahu siswa lain.",
        },
        max_contact_second=3,
    )

    assert result.prediction == "non-bullying"
    assert result.detik_mulai_kontak is None
    assert result.ada_kontak_antar_subjek is False


def test_hallucination_guard_keeps_clear_aggressive_contact():
    result = _validate_classification(
        {
            "ruangan_kosong": False,
            "jumlah_subjek": 2,
            "jenis_kontak": "pukulan",
            "ada_kontak_antar_subjek": True,
            "kronologi_kejadian": "Kepalan mengenai wajah siswa lain.",
            "detik_mulai_kontak": 0.8,
            "confidence": 0.93,
            "prediction": "bullying",
            "reason": "Pukulan sepihak terlihat jelas.",
        },
        max_contact_second=3,
    )

    assert result.prediction == "bullying"
    assert result.jenis_kontak == "pukulan"
    assert result.detik_mulai_kontak == 0.8
