import asyncio
import json

import httpx
import pytest

from app.core.config import Settings
from app.services import gemini_classifier
from app.services.gemini_classifier import GeminiClassifierError, GeminiVideoClassifier


def _settings(retries: int = 0) -> Settings:
    return Settings(
        _env_file=None,
        gemini_api_key="test-key",
        gemini_model_name="test-model",
        gemini_max_retries=retries,
    )


def _response(prediction: str = "bullying") -> httpx.Response:
    result = {
        "ruangan_kosong": False,
        "jumlah_subjek": 2,
        "ada_kontak_antar_subjek": True,
        "kronologi_kejadian": "Satu siswa mendorong siswa lain.",
        "detik_mulai_kontak": 1.0,
        "confidence": 0.91,
        "prediction": prediction,
        "reason": "Kontak fisik terlihat.",
    }
    return httpx.Response(
        200,
        json={"candidates": [{"content": {"parts": [{"text": json.dumps(result)}]}}]},
    )


def test_classifier_retries_rate_limit(monkeypatch):
    calls = 0

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(429) if calls == 1 else _response()

    async def no_backoff(_attempt: int):
        return None

    monkeypatch.setattr(gemini_classifier, "_backoff", no_backoff)

    async def classify():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await GeminiVideoClassifier(_settings(retries=1), client).classify(
                b"video"
            )

    result = asyncio.run(classify())

    assert calls == 2
    assert result.prediction == "bullying"


def test_classifier_reports_invalid_json():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"candidates": [{"content": {"parts": [{"text": "not-json"}]}}]},
        )

    async def classify():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await GeminiVideoClassifier(_settings(), client).classify(b"video")

    with pytest.raises(GeminiClassifierError, match="bukan JSON valid"):
        asyncio.run(classify())


def test_classifier_reports_sanitized_api_error():
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={
                "error": {
                    "status": "PERMISSION_DENIED",
                    "message": "API key test-key was reported as leaked.",
                }
            },
        )

    async def classify():
        async with httpx.AsyncClient(
            transport=httpx.MockTransport(handler)
        ) as client:
            return await GeminiVideoClassifier(_settings(), client).classify(
                b"video"
            )

    with pytest.raises(GeminiClassifierError) as error:
        asyncio.run(classify())

    message = str(error.value)
    assert "PERMISSION_DENIED" in message
    assert "reported as leaked" in message
    assert "test-key" not in message
    assert "[REDACTED]" in message


def test_classifier_reports_request_timeout(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    async def classify():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await GeminiVideoClassifier(_settings(), client).classify(b"video")

    with pytest.raises(GeminiClassifierError, match="tidak dapat dihubungi"):
        asyncio.run(classify())
