from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta
from typing import Any, Literal
from urllib.parse import quote

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.core.config import Settings, get_settings

# ==============================================================================
# PROMPT: ANALISIS EVENT & KRONOLOGI (5-15 DETIK)
# ==============================================================================
CLASSIFICATION_PROMPT = """
Anda adalah sistem forensik video CCTV. Anda menerima rekaman insiden (berdurasi 5-15 detik)
yang dicurigai mengandung anomali gerakan. Tugas Anda adalah memvalidasi apakah ini agresi
fisik (bullying) nyata atau aktivitas normal.

LANGKAH WAJIB (ANTI-HALUSINASI):
1. CEK MANUSIA: Jika tidak ada wujud manusia sama sekali, set `ruangan_kosong`=true,
   `jumlah_subjek`=0, prediksi="non-bullying". BERHENTI.
2. JANGAN MENGARANG: Pantulan cahaya, bayangan, siluet di kaca/cermin/pintu kaca, atau benda
   mati BUKAN manusia. Jika kamera memperlihatkan permukaan reflektif (pintu kaca, cermin,
   jendela), waspadai bahwa gerakan atau bentuk di dalam permukaan tersebut kemungkinan besar
   adalah PANTULAN, bukan orang sungguhan di dalam ruangan. Hanya hitung sebagai manusia jika
   sosoknya jelas berada di ruangan utama (bukan di dalam bidang kaca/cermin) dengan anatomi
   manusia yang konsisten di beberapa frame berturut-turut.
3. Jika ragu apakah suatu bentuk adalah manusia sungguhan atau pantulan/bayangan, JANGAN
   hitung sebagai subjek tambahan.

ANALISIS KRONOLOGI:
Karena klip ini memiliki durasi, perhatikan keseluruhan urutan kejadian (Before -> Action -> After):
- Apakah ada gestur provokasi?
- Apakah terjadi KONTAK FISIK KASAR secara langsung (mendorong, memukul, menendang, menarik paksa)?
- Bagaimana reaksi korban? (Menghindar, terdorong, jatuh).
- Perkirakan pada detik keberapa SEJAK AWAL KLIP kontak fisik agresif pertama kali terjadi.
*Catatan: Kontak fisik kasar sepihak, meskipun pelakunya terlihat tertawa/bercanda, WAJIB
diklasifikasikan sebagai BULLYING.*

KRITERIA KLASIFIKASI:
- BULLYING: >= 2 orang sungguhan di dalam frame DAN terdapat bukti nyata kontak fisik agresif
  antar mereka, DAN Anda bisa menunjukkan perkiraan detik kejadiannya.
- NON-BULLYING: Hanya 0-1 orang, ruangan kosong/hanya pantulan, atau >= 2 orang yang melakukan
  aktivitas normal, berdekatan tanpa agresi, atau melakukan gerakan cepat yang tidak mengenai
  siapa pun (termasuk latihan/olahraga sendirian).

KALIBRASI CONFIDENCE:
- Berikan confidence tinggi (>0.7) hanya jika kontak fisik terlihat jelas dan tidak terhalang.
- Berikan confidence sedang (0.4-0.7) jika ada indikasi kuat tapi sebagian terhalang/ambigu.
- Berikan confidence rendah (<0.4) jika buktinya lemah atau meragukan.

Field `reason` cukup berisi kesimpulan analitis singkat (SATU kalimat). Jangan mencantumkan
jam/waktu di dalam `reason` — waktu kejadian akan dihitung secara terpisah oleh sistem.
"""


class GeminiClassification(BaseModel):
    ruangan_kosong: bool = Field(description="True jika frame benar-benar kosong dari manusia sungguhan.")
    jumlah_subjek: int = Field(ge=0, description="Jumlah manusia sungguhan (bukan pantulan) di frame.")
    ada_kontak_antar_subjek: bool = Field(description="True hanya jika ada kontak fisik agresif nyata antar-subjek.")
    kronologi_kejadian: str = Field(min_length=1, description="Penjelasan singkat awal, puncak, dan akhir gerakan di video.")
    detik_mulai_kontak: float | None = Field(
        default=None,
        ge=0.0,
        description="Perkiraan detik sejak awal klip saat kontak fisik agresif pertama kali terjadi. Null jika non-bullying.",
    )
    confidence: float = Field(ge=0.0, le=1.0)
    prediction: Literal["bullying", "non-bullying"]
    reason: str = Field(min_length=1, description="Kesimpulan analitis singkat, TANPA jam/waktu.")


class GeminiClassifierError(RuntimeError):
    pass


class IncidentReport(BaseModel):
    """Hasil akhir yang siap ditampilkan/dinotifikasikan ke user."""

    prediction: Literal["bullying", "non-bullying"]
    jumlah_subjek: int
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
        clip_started_at: datetime,
        mime_type: str = "video/mp4",
    ) -> IncidentReport:
        """
        clip_started_at: WAJIB diisi dengan waktu asli mulai rekaman klip (dari metadata
        kamera/capture pipeline), BUKAN waktu saat fungsi ini dipanggil. Semua perhitungan
        waktu kejadian didasarkan pada nilai ini + perkiraan detik dari model, supaya
        keterlambatan proses/antrian/retry tidak menggeser jam kejadian yang dilaporkan.
        """
        if not self.settings.gemini_api_key:
            raise GeminiClassifierError("GEMINI_API_KEY belum dikonfigurasi.")
        if not video_bytes:
            raise GeminiClassifierError("Klip video kosong.")

        model_name = quote(self.settings.gemini_model_name, safe="")
        url = f"{self.settings.gemini_api_base_url.rstrip('/')}/models/{model_name}:generateContent"

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
        client = self._client or httpx.AsyncClient(timeout=self.settings.gemini_request_timeout_seconds)
        try:
            response = await self._request_with_retries(client, url, payload)
        finally:
            if owns_client:
                await client.aclose()

        result = _validate_classification(_parse_response_payload(response))
        return _build_incident_report(result, clip_started_at=clip_started_at)

    async def _request_with_retries(self, client: httpx.AsyncClient, url: str, payload: dict[str, Any]) -> httpx.Response:
        headers = {"Content-Type": "application/json", "x-goog-api-key": self.settings.gemini_api_key}
        attempts = max(0, self.settings.gemini_max_retries) + 1

        for attempt in range(attempts):
            try:
                response = await client.post(url, headers=headers, json=payload)
            except httpx.RequestError as error:
                if attempt >= attempts - 1:
                    raise GeminiClassifierError("Gagal menghubungi Gemini.") from error
                await _backoff(attempt)
                continue

            if response.status_code == 200:
                return response
            retryable = response.status_code == 429 or response.status_code >= 500
            if not retryable or attempt >= attempts - 1:
                raise GeminiClassifierError(f"HTTP {response.status_code}")
            await _backoff(attempt)
        raise GeminiClassifierError("Request gagal setelah retry.")


def classification_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "ruangan_kosong": {"type": "boolean"},
            "jumlah_subjek": {"type": "integer"},
            "ada_kontak_antar_subjek": {"type": "boolean"},
            "kronologi_kejadian": {"type": "string"},
            "detik_mulai_kontak": {
                "type": "number",
                "nullable": True,
                "description": "Detik sejak awal klip saat kontak agresif dimulai, null jika non-bullying.",
            },
            "confidence": {"type": "number"},
            "prediction": {"type": "string", "enum": ["bullying", "non-bullying"]},
            "reason": {"type": "string"},
        },
        "required": [
            "ruangan_kosong",
            "jumlah_subjek",
            "ada_kontak_antar_subjek",
            "kronologi_kejadian",
            "detik_mulai_kontak",
            "confidence",
            "prediction",
            "reason",
        ],
    }


def _parse_response_payload(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError:
        raise GeminiClassifierError("Bukan JSON.")
    candidates = payload.get("candidates")
    if not candidates:
        raise GeminiClassifierError("Tidak ada kandidat.")
    text = next(
        (i.get("text", "") for i in candidates[0].get("content", {}).get("parts", []) if isinstance(i, dict)),
        "",
    )
    if not text:
        raise GeminiClassifierError("Hasil kosong.")

    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = "\n".join(cleaned.splitlines()[1:-1]).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        raise GeminiClassifierError("JSON tidak valid.")


def _validate_classification(payload: dict[str, Any]) -> GeminiClassification:
    norm = dict(payload)
    if isinstance(norm.get("prediction"), str):
        norm["prediction"] = norm["prediction"].strip().lower()
    if isinstance(norm.get("confidence"), (int, float)) and 1 < norm["confidence"] <= 100:
        norm["confidence"] /= 100

    try:
        result = GeminiClassification.model_validate(norm)
    except ValidationError as error:
        raise GeminiClassifierError("Format hasil klasifikasi tidak sesuai schema.") from error

    return _apply_hallucination_guard(result)


def _apply_hallucination_guard(result: GeminiClassification) -> GeminiClassification:
    """
    Jaring pengaman: prediksi "bullying" hanya boleh lolos jika model SENDIRI melaporkan
    bukti yang cukup (>=2 subjek, kontak nyata, dan tahu perkiraan detik kejadiannya).
    Kalau salah satu syarat ini tidak terpenuhi -- termasuk saat ruangan_kosong=true --
    prediksi otomatis dikoreksi ke non-bullying, apa pun narasi bebas yang ditulis model.
    """
    if result.prediction != "bullying":
        return result

    tidak_cukup_bukti = (
        result.ruangan_kosong
        or result.jumlah_subjek < 2
        or not result.ada_kontak_antar_subjek
        or result.detik_mulai_kontak is None
    )

    if tidak_cukup_bukti:
        return result.model_copy(
            update={
                "prediction": "non-bullying",
                "reason": result.reason + " [Auto-koreksi: bukti tidak memenuhi syarat minimum bullying.]",
            }
        )

    return result


def _build_incident_report(result: GeminiClassification, *, clip_started_at: datetime) -> IncidentReport:
    if result.prediction == "bullying" and result.detik_mulai_kontak is not None:
        waktu_kejadian = clip_started_at + timedelta(seconds=result.detik_mulai_kontak)
    else:
        waktu_kejadian = clip_started_at

    if result.prediction == "bullying":
        alasan = (
            f"Terdeteksi {result.jumlah_subjek} orang pada {waktu_kejadian:%H:%M:%S} WIB. "
            f"{result.kronologi_kejadian} "
            f"Tingkat keyakinan model: {result.confidence:.0%}."
        )
    else:
        if result.ruangan_kosong:
            alasan = f"Tidak ada orang terdeteksi pada {waktu_kejadian:%H:%M:%S} WIB."
        else:
            alasan = (
                f"Terdeteksi {result.jumlah_subjek} orang pada {waktu_kejadian:%H:%M:%S} WIB, "
                f"tidak ada indikasi kontak fisik agresif. {result.kronologi_kejadian} "
                f"Tingkat keyakinan model: {result.confidence:.0%}."
            )

    return IncidentReport(
        prediction=result.prediction,
        jumlah_subjek=result.jumlah_subjek,
        confidence=result.confidence,
        waktu_kejadian=waktu_kejadian,
        alasan=alasan,
        kronologi_kejadian=result.kronologi_kejadian,
        raw=result,
    )


async def _backoff(attempt: int) -> None:
    import asyncio

    await asyncio.sleep(min(2 ** attempt, 8))