from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta, timezone
from typing import Any, Literal
from urllib.parse import quote

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.core.config import Settings, get_settings

AGGRESSIVE_CONTACT_TYPES: frozenset[str] = frozenset(
    {
        "pukulan",
        "tendangan",
        "dorongan",
        "tamparan",
        "tarikan_paksa",
        "cekikan_atau_jambakan",
        "kontak_kasar_lainnya",
    }
)

NON_AGGRESSIVE_CONTACT_TYPES: frozenset[str] = frozenset(
    {
        "rangkulan_atau_pelukan_bersahabat",
        "pegangan_tangan",
        "tepukan_ringan_bersahabat",
        "bersentuhan_tidak_disengaja",
        "tidak_ada_kontak_fisik",
    }
)

JenisKontak = Literal[
    "pukulan",
    "tendangan",
    "dorongan",
    "tamparan",
    "tarikan_paksa",
    "cekikan_atau_jambakan",
    "kontak_kasar_lainnya",
    "rangkulan_atau_pelukan_bersahabat",
    "pegangan_tangan",
    "tepukan_ringan_bersahabat",
    "bersentuhan_tidak_disengaja",
    "tidak_ada_kontak_fisik",
]

CLASSIFICATION_PROMPT = """
Anda adalah sistem forensik video CCTV sekolah. Anda menerima potongan rekaman pendek dan
harus menentukan apakah terlihat agresi fisik nyata atau aktivitas normal.

LANGKAH WAJIB (ANTI-HALUSINASI):
1. Jika tidak ada manusia sungguhan, set `ruangan_kosong`=true, `jumlah_subjek`=0,
   `jenis_kontak`="tidak_ada_kontak_fisik", `ada_kontak_antar_subjek`=false, dan
   `prediction`="non-bullying".
2. Pantulan, bayangan, siluet pada kaca/cermin, layar, dan benda mati BUKAN manusia.
3. Jika hanya ada satu manusia sungguhan, hasil WAJIB non-bullying.
4. Jangan menyimpulkan kontak hanya dari tangan yang bergerak cepat. Kontak harus benar-benar
   terlihat mengenai atau berdampak pada orang lain dalam beberapa frame yang berurutan.

PILIH SATU `jenis_kontak` YANG PALING DOMINAN:

KONTAK AGRESIF:
- `pukulan`: tangan, kepalan, atau benda memukul tubuh/wajah orang lain.
- `tendangan`: kaki menendang tubuh orang lain.
- `dorongan`: dorongan yang membuat korban terhuyung, mundur paksa, atau jatuh.
- `tamparan`: telapak tangan menampar wajah atau kepala.
- `tarikan_paksa`: menarik rambut, baju, tangan, atau anggota tubuh dengan paksa.
- `cekikan_atau_jambakan`: mencekik leher atau menjambak dengan kekuatan.
- `kontak_kasar_lainnya`: menyikut keras, membanting, menginjak, atau kontak kasar sepihak
  lainnya yang jelas mengenai korban.

KONTAK NON-AGRESIF:
- `rangkulan_atau_pelukan_bersahabat`: merangkul atau memeluk secara akrab.
- `pegangan_tangan`: memegang atau bergandengan tanpa paksaan.
- `tepukan_ringan_bersahabat`: tepukan, tos, atau sentuhan ringan tanpa dampak agresif.
- `bersentuhan_tidak_disengaja`: bersenggolan saat aktivitas normal.
- `tidak_ada_kontak_fisik`: tidak ada sentuhan antar-subjek.

KRITERIA BULLYING:
- Sedikitnya dua manusia sungguhan terlihat.
- `jenis_kontak` termasuk KONTAK AGRESIF.
- Kontak agresif benar-benar mengenai orang lain dan dilakukan secara sepihak.
- Detik awal kontak dapat ditunjukkan sejak awal klip.

Kontak kasar sepihak tetap termasuk bullying meskipun pelaku tertawa atau mengaku bercanda.
Kontak non-agresif tidak boleh dianggap bullying. Jika bukti terhalang, ambigu, atau hanya
berdasarkan dugaan, pilih non-bullying dan turunkan confidence.

KALIBRASI CONFIDENCE:
- Di atas 0.90 hanya jika jenis kontak, pelaku, korban, dan dampaknya terlihat jelas.
- 0.70 sampai 0.90 jika gerakan kuat tetapi sebagian terhalang atau ambigu.
- Di bawah 0.70 jika bukti lemah.

Field `reason` berisi satu kalimat kesimpulan tanpa jam atau waktu.
"""

WIB = timezone(timedelta(hours=7), name="WIB")


class GeminiClassification(BaseModel):
    ruangan_kosong: bool = Field(
        description="True jika video tidak memperlihatkan manusia sungguhan."
    )
    jumlah_subjek: int = Field(
        ge=0,
        description="Jumlah manusia sungguhan, bukan pantulan atau bayangan.",
    )
    jenis_kontak: JenisKontak = Field(
        description="Kategori kontak fisik dominan dari daftar tertutup."
    )
    ada_kontak_antar_subjek: bool = Field(
        description="True hanya untuk kontak fisik agresif yang nyata."
    )
    kronologi_kejadian: str = Field(
        min_length=1,
        description="Urutan singkat sebelum, saat, dan setelah gerakan.",
    )
    detik_mulai_kontak: float | None = Field(
        default=None,
        ge=0.0,
        description=(
            "Detik sejak awal klip saat kontak agresif dimulai. Null untuk "
            "non-bullying."
        ),
    )
    confidence: float = Field(ge=0.0, le=1.0)
    prediction: Literal["bullying", "non-bullying"]
    reason: str = Field(
        min_length=1,
        description="Kesimpulan analitis singkat tanpa jam atau waktu.",
    )


class GeminiClassifierError(RuntimeError):
    """Raised when Gemini cannot return a valid classification."""


class IncidentReport(BaseModel):
    """Classification enriched with the camera timeline occurrence time."""

    prediction: Literal["bullying", "non-bullying"]
    jumlah_subjek: int
    jenis_kontak: JenisKontak
    confidence: float
    waktu_kejadian: datetime
    alasan: str
    kronologi_kejadian: str
    raw: GeminiClassification


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
        clip_duration_seconds: float | None = None,
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
                "maxOutputTokens": 700,
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

        return _validate_classification(
            _parse_response_payload(response),
            max_contact_second=clip_duration_seconds,
        )

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
    contact_types = sorted(AGGRESSIVE_CONTACT_TYPES | NON_AGGRESSIVE_CONTACT_TYPES)
    return {
        "type": "object",
        "properties": {
            "ruangan_kosong": {
                "type": "boolean",
                "description": "True jika tidak ada manusia sungguhan di video.",
            },
            "jumlah_subjek": {
                "type": "integer",
                "description": "Jumlah manusia sungguhan yang terlihat.",
            },
            "jenis_kontak": {
                "type": "string",
                "enum": contact_types,
                "description": "Kategori kontak fisik dominan.",
            },
            "ada_kontak_antar_subjek": {
                "type": "boolean",
                "description": "True hanya jika kontak agresif nyata terlihat.",
            },
            "kronologi_kejadian": {
                "type": "string",
                "description": "Urutan singkat sebelum, saat, dan setelah gerakan.",
            },
            "detik_mulai_kontak": {
                "type": "number",
                "nullable": True,
                "description": (
                    "Detik sejak awal klip saat kontak agresif dimulai, null jika "
                    "non-bullying."
                ),
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
                "description": "Kesimpulan singkat tanpa jam atau waktu.",
            },
        },
        "required": [
            "ruangan_kosong",
            "jumlah_subjek",
            "jenis_kontak",
            "ada_kontak_antar_subjek",
            "kronologi_kejadian",
            "detik_mulai_kontak",
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
        raise GeminiClassifierError(
            "Hasil klasifikasi Gemini bukan JSON valid."
        ) from error

    if not isinstance(parsed, dict):
        raise GeminiClassifierError(
            "Hasil klasifikasi Gemini harus berupa object JSON."
        )
    return parsed


def _validate_classification(
    payload: dict[str, Any],
    *,
    max_contact_second: float | None = None,
) -> GeminiClassification:
    normalized = dict(payload)
    prediction = normalized.get("prediction")
    if isinstance(prediction, str):
        normalized["prediction"] = prediction.strip().lower()

    contact_type = normalized.get("jenis_kontak")
    if isinstance(contact_type, str):
        normalized["jenis_kontak"] = (
            contact_type.strip().lower().replace(" ", "_").replace("-", "_")
        )

    confidence = normalized.get("confidence")
    if isinstance(confidence, (int, float)) and 1 < confidence <= 100:
        normalized["confidence"] = confidence / 100

    try:
        result = GeminiClassification.model_validate(normalized)
    except ValidationError as error:
        raise GeminiClassifierError(
            "Format hasil klasifikasi Gemini tidak sesuai schema."
        ) from error

    return _apply_hallucination_guard(
        result,
        max_contact_second=max_contact_second,
    )


def _apply_hallucination_guard(
    result: GeminiClassification,
    *,
    max_contact_second: float | None = None,
) -> GeminiClassification:
    if result.ruangan_kosong:
        return result.model_copy(
            update={
                "jumlah_subjek": 0,
                "jenis_kontak": "tidak_ada_kontak_fisik",
                "ada_kontak_antar_subjek": False,
                "detik_mulai_kontak": None,
                "prediction": "non-bullying",
            }
        )

    contact_is_aggressive = result.jenis_kontak in AGGRESSIVE_CONTACT_TYPES
    contact_outside_clip = (
        max_contact_second is not None
        and result.detik_mulai_kontak is not None
        and result.detik_mulai_kontak > max_contact_second
    )
    insufficient_evidence = (
        result.jumlah_subjek < 2
        or not result.ada_kontak_antar_subjek
        or not contact_is_aggressive
        or result.detik_mulai_kontak is None
        or contact_outside_clip
    )

    if result.prediction == "bullying" and insufficient_evidence:
        return result.model_copy(
            update={
                "ada_kontak_antar_subjek": (
                    result.ada_kontak_antar_subjek and contact_is_aggressive
                ),
                "prediction": "non-bullying",
                "detik_mulai_kontak": None,
                "reason": (
                    result.reason
                    + " [Auto-koreksi: bukti tidak memenuhi syarat minimum "
                    "bullying.]"
                ),
            }
        )

    if result.prediction == "non-bullying":
        return result.model_copy(update={"detik_mulai_kontak": None})

    return result


def build_incident_report(
    result: GeminiClassification,
    *,
    clip_started_at: datetime,
) -> IncidentReport:
    if clip_started_at.tzinfo is None:
        clip_started_at = clip_started_at.replace(tzinfo=UTC)

    if result.prediction == "bullying" and result.detik_mulai_kontak is not None:
        occurrence_time = clip_started_at + timedelta(
            seconds=result.detik_mulai_kontak
        )
    else:
        occurrence_time = clip_started_at
    occurrence_time_wib = occurrence_time.astimezone(WIB)
    contact_label = result.jenis_kontak.replace("_", " ")

    if result.prediction == "bullying":
        reason = (
            f"Terdeteksi {result.jumlah_subjek} orang pada "
            f"{occurrence_time_wib:%H:%M:%S} WIB "
            f"dengan jenis kontak {contact_label}. "
            f"{result.kronologi_kejadian} "
            f"Tingkat keyakinan model: {result.confidence:.0%}."
        )
    elif result.ruangan_kosong:
        reason = (
            f"Tidak ada orang terdeteksi pada {occurrence_time_wib:%H:%M:%S} WIB."
        )
    else:
        reason = (
            f"Terdeteksi {result.jumlah_subjek} orang pada "
            f"{occurrence_time_wib:%H:%M:%S} WIB, tidak ada indikasi kontak "
            f"fisik agresif. Jenis kontak: {contact_label}. "
            f"{result.kronologi_kejadian} "
            f"Tingkat keyakinan model: {result.confidence:.0%}."
        )

    return IncidentReport(
        prediction=result.prediction,
        jumlah_subjek=result.jumlah_subjek,
        jenis_kontak=result.jenis_kontak,
        confidence=result.confidence,
        waktu_kejadian=occurrence_time,
        alasan=reason,
        kronologi_kejadian=result.kronologi_kejadian,
        raw=result,
    )


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

    await asyncio.sleep(min(2**attempt, 8))
