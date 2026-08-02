from __future__ import annotations

import base64
import json
from typing import Any, Literal
from urllib.parse import quote

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.core.config import Settings, get_settings


CLASSIFICATION_PROMPT = """
Anda adalah sistem forensik video CCTV sekolah yang berspesialisasi dalam mendeteksi agresi fisik dan bullying pada potongan klip pendek (3 detik).

Periksa gerakan fisik pada seluruh frame yang diberikan: gerakan tangan, kaki, posisi tubuh, arah gerak, kontak fisik, dan reaksi subjek. Jangan menyimpulkan bullying hanya karena dua orang berada berdekatan.

Panduan evaluasi:
1. BULLYING / AGRESI FISIK: Ada kontak fisik agresif seperti mendorong, memukul, menendang, menjambak, mencekik, menarik paksa, gestur mengancam, atau memojokkan seseorang secara agresif. Jika terlihat dorongan atau pukulan fisik sepihak, klasifikasikan sebagai bullying meskipun mungkin diklaim bercanda.
2. NON-BULLYING: Tidak ada kontak fisik agresif. Berjalan, duduk, berbicara, bermain secara netral, atau berdiri biasa bukan bullying.

Jawab berdasarkan bukti visual yang benar-benar terlihat. Jangan mengarang identitas, niat, atau kejadian yang tidak tampak.
"""


class GeminiClassification(BaseModel):
    observasi_gerakan: str = Field(min_length=1)
    analisis_kontak_fisik: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    prediction: Literal["bullying", "non-bullying"]
    reason: str = Field(min_length=1)


class GeminiClassifierError(RuntimeError):
    """Raised when Gemini cannot return a valid classification."""


class GeminiVideoClassifier:
    def __init__(
        self,
        settings: Settings | None = None,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self._client = client

    async def classify(
        self,
        video_bytes: bytes,
        *,
        mime_type: str = "video/mp4",
    ) -> GeminiClassification:
        if not self.settings.gemini_api_key:
            raise GeminiClassifierError(
                "GEMINI_API_KEY belum dikonfigurasi pada AI worker."
            )
        if not video_bytes:
            raise GeminiClassifierError("Klip video kosong.")
        if len(video_bytes) > self.settings.gemini_inline_max_bytes:
            raise GeminiClassifierError(
                "Klip video terlalu besar untuk dikirim inline ke Gemini."
            )

        model_name = quote(self.settings.gemini_model_name, safe="")
        url = (
            self.settings.gemini_api_base_url.rstrip("/")
            + f"/models/{model_name}:generateContent"
        )
        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {
                            "inlineData": {
                                "mimeType": mime_type,
                                "data": base64.b64encode(video_bytes).decode("ascii"),
                            },
                            "videoMetadata": {
                                "fps": self.settings.gemini_video_fps,
                            },
                        },
                        {"text": CLASSIFICATION_PROMPT},
                    ],
                }
            ],
            "generationConfig": {
                "temperature": 0,
                "maxOutputTokens": 512,
                "responseMimeType": "application/json",
                "responseSchema": classification_schema(),
            },
        }

        owns_client = self._client is None
        client = self._client or httpx.AsyncClient(
            timeout=self.settings.gemini_request_timeout_seconds
        )
        try:
            response = await self._request_with_retries(client, url, payload)
        finally:
            if owns_client:
                await client.aclose()

        response_payload = _parse_response_payload(response)
        return _validate_classification(response_payload)

    async def _request_with_retries(
        self,
        client: httpx.AsyncClient,
        url: str,
        payload: dict[str, Any],
    ) -> httpx.Response:
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.settings.gemini_api_key,
        }
        attempts = max(0, self.settings.gemini_max_retries) + 1

        for attempt in range(attempts):
            try:
                response = await client.post(url, headers=headers, json=payload)
            except httpx.RequestError as error:
                if attempt >= attempts - 1:
                    raise GeminiClassifierError(
                        "Gemini tidak dapat dihubungi."
                    ) from error
                await _backoff(attempt)
                continue

            if response.status_code == 200:
                return response

            retryable = response.status_code == 429 or response.status_code >= 500
            if not retryable or attempt >= attempts - 1:
                detail = _gemini_error_detail(
                    response,
                    secret=self.settings.gemini_api_key,
                )
                suffix = f": {detail}" if detail else "."
                raise GeminiClassifierError(
                    f"Gemini mengembalikan HTTP {response.status_code}{suffix}"
                )
            await _backoff(attempt)

        raise GeminiClassifierError("Permintaan ke Gemini gagal setelah retry.")


def classification_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "observasi_gerakan": {
                "type": "string",
                "description": "Kronologi singkat gerakan fisik yang terlihat.",
            },
            "analisis_kontak_fisik": {
                "type": "string",
                "description": "Analisis spesifik tentang kontak atau gestur intimidasi.",
            },
            "confidence": {
                "type": "number",
                "description": "Keyakinan antara 0.0 dan 1.0.",
            },
            "prediction": {
                "type": "string",
                "enum": ["bullying", "non-bullying"],
            },
            "reason": {
                "type": "string",
                "description": "Kesimpulan satu kalimat berbasis bukti.",
            },
        },
        "required": [
            "observasi_gerakan",
            "analisis_kontak_fisik",
            "confidence",
            "prediction",
            "reason",
        ],
    }


def _gemini_error_detail(
    response: httpx.Response,
    *,
    secret: str,
) -> str | None:
    try:
        payload = response.json()
    except ValueError:
        return None

    error = payload.get("error") if isinstance(payload, dict) else None
    if not isinstance(error, dict):
        return None

    status = error.get("status")
    message = error.get("message")
    parts = [value for value in (status, message) if isinstance(value, str)]
    detail = ": ".join(parts)
    if secret:
        detail = detail.replace(secret, "[REDACTED]")
    normalized = " ".join(detail.split())
    return normalized[:500] or None


def _parse_response_payload(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except (ValueError, json.JSONDecodeError) as error:
        raise GeminiClassifierError("Respons Gemini bukan JSON yang valid.") from error

    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        feedback = payload.get("promptFeedback")
        reason = feedback.get("blockReason") if isinstance(feedback, dict) else None
        suffix = f" ({reason})" if reason else ""
        raise GeminiClassifierError(f"Gemini tidak mengembalikan kandidat{suffix}.")

    first = candidates[0]
    content = first.get("content") if isinstance(first, dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    text = ""
    if isinstance(parts, list):
        text = next(
            (
                item.get("text", "")
                for item in parts
                if isinstance(item, dict) and isinstance(item.get("text"), str)
            ),
            "",
        )

    if not text:
        raise GeminiClassifierError("Respons Gemini tidak berisi hasil klasifikasi.")

    try:
        parsed = json.loads(_strip_json_fence(text))
    except json.JSONDecodeError as error:
        raise GeminiClassifierError("Hasil klasifikasi Gemini bukan JSON valid.") from error

    if not isinstance(parsed, dict):
        raise GeminiClassifierError("Hasil klasifikasi Gemini harus berupa object JSON.")
    return parsed


def _validate_classification(payload: dict[str, Any]) -> GeminiClassification:
    normalized = dict(payload)
    prediction = normalized.get("prediction")
    if isinstance(prediction, str):
        normalized["prediction"] = prediction.strip().lower()

    confidence = normalized.get("confidence")
    if isinstance(confidence, (int, float)) and confidence > 1 and confidence <= 100:
        normalized["confidence"] = confidence / 100

    try:
        return GeminiClassification.model_validate(normalized)
    except ValidationError as error:
        raise GeminiClassifierError(
            "Format hasil klasifikasi Gemini tidak sesuai schema."
        ) from error


def _strip_json_fence(value: str) -> str:
    cleaned = value.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    return cleaned


async def _backoff(attempt: int) -> None:
    import asyncio

    await asyncio.sleep(min(2 ** attempt, 8))