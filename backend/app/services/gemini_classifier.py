from __future__ import annotations

import base64
import json
from datetime import datetime
from typing import Any, Literal
from urllib.parse import quote

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.core.config import Settings, get_settings

# ==============================================================================
# PROMPT HYBRID: AKURASI 81% + ANTI-HALUSINASI
# ==============================================================================
CLASSIFICATION_PROMPT = """
Anda adalah sistem forensik video CCTV yang objektif dan berspesialisasi dalam mendeteksi agresi fisik (bullying) pada potongan klip pendek (3 detik).
Karena ini dari kamera pengawas, Anda WAJIB memperhatikan setiap frame gerakan fisik secara mendetail (gerakan tangan, kaki, posisi tubuh, dan reaksi korban).

LANGKAH WAJIB SEBELUM MENGANALISIS (ANTI-HALUSINASI):
1. CEK KEBERADAAN MANUSIA: Apakah ada wujud manusia yang terlihat jelas di frame?
   - Jika TIDAK ADA orang sama sekali (ruangan kosong/hanya barang), set `ruangan_kosong` = true dan `jumlah_subjek` = 0. BERHENTI MENCARI dan langsung klasifikasikan sebagai "non-bullying".
2. JANGAN MENGARANG: Dilarang keras mendeskripsikan gerakan atau interaksi jika wujud manusianya tidak ada di layar. Pantulan cahaya atau bayangan BUKAN manusia.

PANDUAN EVALUASI AGRESI (KLASIFIKASI):
1. BULLYING / AGRESI FISIK: Wajib ada ≥ 2 orang. Terdapat kontak fisik agresif (mendorong, memukul, menendang, menjambak, mencekik, menarik paksa), gestur mengancam, atau memojokkan seseorang. 
   - ATURAN KETAT: Jika ada dorongan atau pukulan fisik secara sepihak, klasifikasikan sebagai BULLYING meskipun mungkin terlihat seperti "bercanda". Jangan kompromi dengan kontak fisik tanpa izin.
2. NON-BULLYING: Ruangan kosong (0 orang), hanya 1 orang, atau ≥ 2 orang namun TIDAK ADA kontak fisik agresif sama sekali (hanya berjalan, duduk, berbicara, atau berdiri netral tanpa gestur intimidasi).

FORMAT ALASAN (reason):
Gunakan format baku ini: "Terdeteksi [jumlah_subjek] orang. Tindakan: [Deskripsi tindakan yang benar-benar terlihat]."
Contoh Ruangan Kosong: "Terdeteksi 0 orang. Tindakan: Ruangan kosong."
Contoh Bullying: "Terdeteksi 2 orang. Tindakan: Satu orang menarik paksa dan mendorong tubuh orang lainnya."
"""

# ==============================================================================
# PYDANTIC MODEL (SKEMA JSON DENGAN PARAMETER RUANGAN KOSONG)
# ==============================================================================
class GeminiClassification(BaseModel):
    ruangan_kosong: bool = Field(
        description="WAJIB True jika tidak ada satupun wujud manusia yang terlihat di video (ruangan kosong/hanya barang)."
    )
    jumlah_subjek: int = Field(
        ge=0, 
        description="Jumlah orang yang terlihat. Jika ruangan_kosong True, ini WAJIB 0."
    )
    ada_kontak_antar_subjek: bool = Field(
        description="True hanya jika ada kontak fisik nyata yang mengenai subjek lain."
    )
    observasi_gerakan: str = Field(min_length=1)
    analisis_kontak_fisik: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    prediction: Literal["bullying", "non-bullying"]
    reason: str = Field(
        min_length=1,
        description="Format WAJIB: 'Terdeteksi [X] orang. Tindakan: [Deskripsi].'"
    )


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
                "temperature": 0.1,  # Sedikit di atas 0 agar lebih luwes dalam deskripsi forensik
                "maxOutputTokens": 600,
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
            "ruangan_kosong": {
                "type": "boolean",
                "description": "WAJIB True jika tidak ada satupun wujud manusia di video (hanya ruangan kosong).",
            },
            "jumlah_subjek": {
                "type": "integer",
                "description": "Jumlah orang yang benar-benar teridentifikasi di frame sepanjang klip.",
            },
            "ada_kontak_antar_subjek": {
                "type": "boolean",
                "description": "True hanya jika ada kontak fisik nyata yang mengenai subjek lain.",
            },
            "observasi_gerakan": {
                "type": "string",
                "description": "Kronologi singkat gerakan fisik yang terlihat, termasuk jumlah orang.",
            },
            "analisis_kontak_fisik": {
                "type": "string",
                "description": "Analisis spesifik tentang kontak atau gestur intimidasi antar-subjek.",
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
                "description": "Kesimpulan ringkas. WAJIB diawali dengan 'Terdeteksi [X] orang. Tindakan: [Y].'",
            },
        },
        "required": [
            "ruangan_kosong",
            "jumlah_subjek",
            "ada_kontak_antar_subjek",
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
        result = GeminiClassification.model_validate(normalized)
    except ValidationError as error:
        raise GeminiClassifierError(
            "Format hasil klasifikasi Gemini tidak sesuai schema."
        ) from error

    return _apply_hallucination_guard(result)


def _apply_hallucination_guard(result: GeminiClassification) -> GeminiClassification:
    """
    Jaring pengaman terhadap halusinasi model dan penyisipan waktu server asli.
    """
    # Ambil waktu asli dari sistem server saat deteksi terjadi
    current_time = datetime.now().strftime("%H.%M.%S WIB")

    if result.prediction != "bullying":
        return result

    # Cek indikasi AI berhalusinasi
    insufficient_subjects = result.jumlah_subjek < 2
    no_contact_reported = not result.ada_kontak_antar_subjek
    is_empty_room = result.ruangan_kosong

    # Jika terdeteksi halusinasi (ruangan kosong tapi AI bilang bullying)
    # Paksa ganti status jadi non-bullying secara sepihak
    if is_empty_room or insufficient_subjects or no_contact_reported:
        override_reason = (
            f"Terdeteksi {result.jumlah_subjek} orang. Tindakan: Tidak ada aktivitas agresif "
            f"(Koreksi Sistem Otomatis). Waktu: {current_time}."
        )
        return result.model_copy(
            update={
                "prediction": "non-bullying",
                "reason": override_reason,
            }
        )

    # Jika memang valid bullying, tambahkan jam di kalimat terakhir reason
    result.reason = f"{result.reason} Waktu: {current_time}."
    
    return result


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