import asyncio
import base64
import json

import httpx
import pytest

from app.core.config import Settings
from app.services.gemini_classifier import (
    GeminiClassifierError,
    GeminiVideoClassifier,
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
            "observasi_gerakan": "Satu siswa mendorong siswa lain.",
            "analisis_kontak_fisik": "Terlihat dorongan sepihak.",
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
            return await classifier.classify(b"fake-mp4")

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
