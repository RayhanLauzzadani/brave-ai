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
# KATEGORI JENIS KONTAK FISIK
# ==============================================================================
# Daftar ini adalah "closed set" yang WAJIB dipatuhi model lewat responseSchema
# (lihat classification_schema()). Model tidak boleh menulis kategori bebas di
# luar daftar ini -- ini yang membuat pembeda bullying vs bukan-bullying bersifat
# deterministik, bisa diaudit, dan tidak bergantung pada nada/emosi pelaku
# (tertawa/bercanda tidak mengubah kategori).

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

# ==============================================================================
# PROMPT: ANALISIS EVENT & KRONOLOGI (5-15 DETIK)
# ==============================================================================
CLASSIFICATION_PROMPT = """
Anda adalah sistem forensik video CCTV. Anda menerima dan melihat rekaman insiden yang diambil dari
aplikasi dan kamera yang terhubung secara live dan realtime, anda bisa juga menganalisis 
video clip berdurasi 5-15 detik yang dicurigai mengandung anomali gerakan yakni bullying. 
Tugas Anda adalah memvalidasi apakah ini agresi fisik (bullying) nyata atau aktivitas normal.

LANGKAH WAJIB (ANTI-HALUSINASI):
1. CEK MANUSIA: Jika tidak ada wujud manusia sama sekali, set `ruangan_kosong`=true,
   `jumlah_subjek`=0, `jenis_kontak`="tidak_ada_kontak_fisik", `ada_kontak_antar_subjek`=false,
   prediksi="non-bullying". BERHENTI.
2. JANGAN MENGARANG: Pantulan cahaya, bayangan, siluet di kaca/cermin/pintu kaca, atau benda
   mati BUKAN manusia. Jika kamera memperlihatkan permukaan reflektif (pintu kaca, cermin,
   jendela), waspadai bahwa gerakan atau bentuk di dalam permukaan tersebut kemungkinan besar
   adalah PANTULAN, bukan orang sungguhan di dalam ruangan. Hanya hitung sebagai manusia jika
   sosoknya jelas berada di ruangan utama (bukan di dalam bidang kaca/cermin) dengan anatomi
   manusia yang konsisten di beberapa frame berturut-turut.
3. Jika ragu apakah suatu bentuk adalah manusia sungguhan atau pantulan/bayangan, JANGAN
   hitung sebagai subjek tambahan.

KLASIFIKASI JENIS KONTAK FISIK (WAJIB DIISI, PILIH SATU YANG PALING DOMINAN):
Anda WAJIB mengisi `jenis_kontak` dengan SATU nilai dari daftar tertutup berikut. Nilai ini
yang menentukan apakah insiden tergolong bullying atau bukan -- bukan kesan umum, bukan nada,
dan bukan ekspresi wajah pelaku.

  KONTAK AGRESIF (indikasi fisik bullying jika dilakukan SEPIHAK oleh satu subjek dan
  benar-benar mengenai/berdampak pada subjek lain):
  - "pukulan": memukul dengan tangan/kepalan/benda ke arah tubuh atau wajah orang lain.
  - "tendangan": menendang ke arah tubuh orang lain.
  - "dorongan": mendorong hingga korban terhuyung, mundur paksa, atau jatuh.
  - "tamparan": menampar wajah/kepala orang lain.
  - "tarikan_paksa": menarik paksa rambut, kerah/baju, tangan, atau anggota tubuh lain.
  - "cekikan_atau_jambakan": mencekik leher atau menjambak dengan kekuatan.
  - "kontak_kasar_lainnya": kontak fisik kasar sepihak lain yang jelas berdampak buruk tapi
    tidak masuk kategori di atas (misal membanting, menyikut keras, menginjak).

  KONTAK NON-AGRESIF (BUKAN bullying, meskipun ada sentuhan fisik atau kedekatan):
  - "rangkulan_atau_pelukan_bersahabat": merangkul bahu, memeluk, sikap akrab/bersahabat.
  - "pegangan_tangan": bergandengan atau memegang tangan tanpa paksaan.
  - "tepukan_ringan_bersahabat": tepukan ringan di bahu/punggung/tangan yang bersifat
    menyapa, memberi semangat, tos/high-five, atau bercanda ringan TANPA membuat korban
    terhuyung, kesakitan, atau menghindar.
  - "bersentuhan_tidak_disengaja": bersenggolan/berdekatan/bersandar akibat aktivitas normal
    (berjalan, mengantre, bermain bersama) tanpa niat atau dampak agresif.
  - "tidak_ada_kontak_fisik": subjek berada di ruangan/frame yang sama namun sama sekali
    tidak bersentuhan.

  CATATAN PENTING:
  - Kontak yang masuk daftar AGRESIF dan dilakukan SEPIHAK oleh satu subjek serta mengenai
    subjek lain WAJIB dianggap indikasi bullying, WALAUPUN pelakunya terlihat tertawa/bercanda
    atau korban tidak menunjukkan reaksi kesakitan yang jelas.
  - Sebaliknya, kontak dalam daftar NON-AGRESIF TIDAK BOLEH dianggap bullying walau dilakukan
    cukup erat/kuat (misal pelukan erat, gandengan tangan erat), SELAMA tidak berubah menjadi
    salah satu bentuk kontak AGRESIF di atas.

ANALISIS KRONOLOGI:
Karena pada sistem ada klip berdurasi, perhatikan keseluruhan urutan kejadian (Before -> Action -> After):
- Apakah ada gestur provokasi?
- Apakah terjadi KONTAK FISIK KASAR secara langsung (menampar, mendorong, memukul, menendang,
  menarik paksa, mencekik/menjambak)?
- Bagaimana reaksi korban? (Menghindar, terdorong, jatuh, atau justru membalas dengan sikap
  akrab seperti tertawa bersama/merangkul balik).
- Perkirakan pada detik keberapa SEJAK AWAL KLIP kontak fisik agresif pertama kali terjadi.
*Catatan: Kontak fisik kasar sepihak, meskipun pelakunya terlihat tertawa/bercanda, WAJIB
diklasifikasikan sebagai BULLYING.*

KRITERIA KLASIFIKASI:
- BULLYING: >= 2 orang sungguhan di dalam frame, `jenis_kontak` termasuk kategori AGRESIF,
  kontak tersebut benar-benar mengenai/berdampak pada subjek lain, DAN Anda bisa menunjukkan
  perkiraan detik kejadiannya.
- NON-BULLYING: Hanya 0-1 orang, ruangan kosong/hanya pantulan, `jenis_kontak` termasuk
  kategori NON-AGRESIF, atau >= 2 orang yang melakukan aktivitas normal/berdekatan tanpa
  kontak agresif (termasuk latihan/olahraga sendirian).

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
    jenis_kontak: JenisKontak = Field(
        description=(
            "Kategori kontak fisik yang paling dominan teramati antar-subjek. Pilih SATU nilai "
            "dari daftar kontak AGRESIF (pukulan, tendangan, dorongan, tamparan, tarikan_paksa, "
            "cekikan_atau_jambakan, kontak_kasar_lainnya) atau daftar kontak NON-AGRESIF "
            "(rangkulan_atau_pelukan_bersahabat, pegangan_tangan, tepukan_ringan_bersahabat, "
            "bersentuhan_tidak_disengaja, tidak_ada_kontak_fisik)."
        )
    )
    ada_kontak_antar_subjek: bool = Field(
        description=(
            "True hanya jika ada kontak fisik agresif nyata antar-subjek -- harus konsisten "
            "dengan `jenis_kontak` (true iff jenis_kontak termasuk kategori AGRESIF dan benar-benar "
            "mengenai subjek lain)."
        )
    )
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
    jenis_kontak: str
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
            "jenis_kontak": {
                "type": "string",
                "enum": sorted(AGGRESSIVE_CONTACT_TYPES | NON_AGGRESSIVE_CONTACT_TYPES),
                "description": (
                    "Kategori kontak fisik paling dominan antar-subjek. Harus salah satu dari "
                    "daftar kontak agresif atau non-agresif yang didefinisikan di prompt."
                ),
            },
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
            "jenis_kontak",
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
    if isinstance(norm.get("jenis_kontak"), str):
        norm["jenis_kontak"] = norm["jenis_kontak"].strip().lower().replace(" ", "_").replace("-", "_")
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
    bukti yang cukup -- >=2 subjek, kontak nyata, tahu perkiraan detiknya, DAN jenis_kontak
    yang dilaporkan termasuk kategori AGRESIF (pukulan/tendangan/dorongan/tamparan/tarikan
    paksa/cekikan-jambakan/kontak kasar lainnya). Kalau jenis_kontak ternyata termasuk
    kategori non-agresif (mis. rangkulan, pegangan tangan, tepukan bersahabat) -- meskipun
    model sempat menandai prediction="bullying" -- prediksi otomatis dikoreksi ke
    non-bullying, apa pun narasi bebas yang ditulis model. Ini mencegah gestur akrab
    (rangkulan, gandengan tangan, berdekatan) ikut tertandai sebagai bullying.
    """
    if result.prediction != "bullying":
        return result

    tidak_cukup_bukti = (
        result.ruangan_kosong
        or result.jumlah_subjek < 2
        or not result.ada_kontak_antar_subjek
        or result.detik_mulai_kontak is None
        or result.jenis_kontak not in AGGRESSIVE_CONTACT_TYPES
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

    jenis_kontak_label = result.jenis_kontak.replace("_", " ")

    if result.prediction == "bullying":
        alasan = (
            f"Terdeteksi {result.jumlah_subjek} orang pada {waktu_kejadian:%H:%M:%S} WIB "
            f"(jenis kontak: {jenis_kontak_label}). "
            f"{result.kronologi_kejadian} "
            f"Tingkat keyakinan model: {result.confidence:.0%}."
        )
    else:
        if result.ruangan_kosong:
            alasan = f"Tidak ada orang terdeteksi pada {waktu_kejadian:%H:%M:%S} WIB."
        else:
            alasan = (
                f"Terdeteksi {result.jumlah_subjek} orang pada {waktu_kejadian:%H:%M:%S} WIB, "
                f"tidak ada indikasi kontak fisik agresif (jenis kontak: {jenis_kontak_label}). "
                f"{result.kronologi_kejadian} "
                f"Tingkat keyakinan model: {result.confidence:.0%}."
            )

    return IncidentReport(
        prediction=result.prediction,
        jumlah_subjek=result.jumlah_subjek,
        jenis_kontak=result.jenis_kontak,
        confidence=result.confidence,
        waktu_kejadian=waktu_kejadian,
        alasan=alasan,
        kronologi_kejadian=result.kronologi_kejadian,
        raw=result,
    )


async def _backoff(attempt: int) -> None:
    import asyncio

    await asyncio.sleep(min(2 ** attempt, 8))