from __future__ import annotations

import base64
import json
from datetime import UTC, datetime, timedelta, timezone
from typing import Any, Literal
from urllib.parse import quote

import httpx
from pydantic import BaseModel, Field, ValidationError

from app.core.config import Settings, get_settings

<<<<<<< HEAD
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
=======
CLASSIFICATION_PROMPT = """
Anda adalah sistem forensik video CCTV. Anda menerima potongan rekaman pendek yang dicurigai
mengandung anomali gerakan. Tugas Anda adalah memvalidasi apakah ini agresi fisik (bullying)
nyata atau aktivitas normal.
>>>>>>> fe31edead1edea9f83f1089c3b2f3df2a12f74fd

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
<<<<<<< HEAD
Karena pada sistem ada klip berdurasi, perhatikan keseluruhan urutan kejadian (Before -> Action -> After):
- Apakah ada gestur provokasi?
- Apakah terjadi KONTAK FISIK KASAR secara langsung (menampar, mendorong, memukul, menendang,
  menarik paksa, mencekik/menjambak)?
- Bagaimana reaksi korban? (Menghindar, terdorong, jatuh, atau justru membalas dengan sikap
  akrab seperti tertawa bersama/merangkul balik).
=======
Karena klip ini memiliki durasi, perhatikan keseluruhan urutan kejadian (Before -> Action ->
After):
- Apakah ada gestur provokasi?
- Apakah terjadi KONTAK FISIK KASAR secara langsung (mendorong, memukul, menendang, menarik
  paksa)?
- Bagaimana reaksi korban? (Menghindar, terdorong, jatuh).
>>>>>>> fe31edead1edea9f83f1089c3b2f3df2a12f74fd
- Perkirakan pada detik keberapa SEJAK AWAL KLIP kontak fisik agresif pertama kali terjadi.
Catatan: Kontak fisik kasar sepihak, meskipun pelakunya terlihat tertawa/bercanda, WAJIB
diklasifikasikan sebagai BULLYING.

KRITERIA KLASIFIKASI:
<<<<<<< HEAD
- BULLYING: >= 2 orang sungguhan di dalam frame, `jenis_kontak` termasuk kategori AGRESIF,
  kontak tersebut benar-benar mengenai/berdampak pada subjek lain, DAN Anda bisa menunjukkan
  perkiraan detik kejadiannya.
- NON-BULLYING: Hanya 0-1 orang, ruangan kosong/hanya pantulan, `jenis_kontak` termasuk
  kategori NON-AGRESIF, atau >= 2 orang yang melakukan aktivitas normal/berdekatan tanpa
  kontak agresif (termasuk latihan/olahraga sendirian).
=======
- BULLYING: Setidaknya 2 orang sungguhan di dalam frame DAN terdapat bukti nyata kontak fisik
  agresif antar mereka, DAN Anda bisa menunjukkan perkiraan detik kejadiannya.
- NON-BULLYING: Hanya 0-1 orang, ruangan kosong/hanya pantulan, atau setidaknya 2 orang yang
  melakukan aktivitas normal, berdekatan tanpa agresi, atau melakukan gerakan cepat yang tidak
  mengenai siapa pun (termasuk latihan/olahraga sendirian).
>>>>>>> fe31edead1edea9f83f1089c3b2f3df2a12f74fd

KALIBRASI CONFIDENCE:
- Berikan confidence tinggi (>0.7) hanya jika kontak fisik terlihat jelas dan tidak terhalang.
- Berikan confidence sedang (0.4-0.7) jika ada indikasi kuat tapi sebagian terhalang/ambigu.
- Berikan confidence rendah (<0.4) jika buktinya lemah atau meragukan.

Field `reason` cukup berisi kesimpulan analitis singkat (SATU kalimat). Jangan mencantumkan
jam/waktu di dalam `reason` - waktu kejadian akan dihitung secara terpisah oleh sistem.
"""

WIB = timezone(timedelta(hours=7), name="WIB")


class GeminiClassification(BaseModel):
<<<<<<< HEAD
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
=======
    ruangan_kosong: bool = Field(
        description="True jika frame benar-benar kosong dari manusia sungguhan."
    )
    jumlah_subjek: int = Field(
        ge=0,
        description="Jumlah manusia sungguhan (bukan pantulan) di frame.",
    )
    ada_kontak_antar_subjek: bool = Field(
        description="True hanya jika ada kontak fisik agresif nyata antar-subjek."
    )
    kronologi_kejadian: str = Field(
        min_length=1,
        description="Penjelasan singkat awal, puncak, dan akhir gerakan di video.",
    )
>>>>>>> fe31edead1edea9f83f1089c3b2f3df2a12f74fd
    detik_mulai_kontak: float | None = Field(
        default=None,
        ge=0.0,
        description=(
            "Perkiraan detik sejak awal klip saat kontak fisik agresif pertama "
            "kali terjadi. Null jika non-bullying."
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
    return {
        "type": "object",
        "properties": {
<<<<<<< HEAD
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
=======
            "ruangan_kosong": {
                "type": "boolean",
                "description": "True jika tidak ada manusia sungguhan di video.",
            },
            "jumlah_subjek": {
                "type": "integer",
                "description": "Jumlah manusia sungguhan yang terlihat.",
            },
            "ada_kontak_antar_subjek": {
                "type": "boolean",
                "description": "True jika ada kontak fisik agresif nyata.",
            },
            "kronologi_kejadian": {
                "type": "string",
                "description": "Urutan singkat awal, puncak, dan akhir gerakan.",
            },
>>>>>>> fe31edead1edea9f83f1089c3b2f3df2a12f74fd
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
                "description": "Kesimpulan analitis singkat tanpa jam atau waktu.",
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
<<<<<<< HEAD
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
=======
        raise GeminiClassifierError("Respons Gemini tidak berisi hasil klasifikasi.")
>>>>>>> fe31edead1edea9f83f1089c3b2f3df2a12f74fd

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


<<<<<<< HEAD
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
=======
def _apply_hallucination_guard(
    result: GeminiClassification,
    *,
    max_contact_second: float | None = None,
) -> GeminiClassification:
    if result.ruangan_kosong:
        return result.model_copy(
            update={
                "jumlah_subjek": 0,
                "ada_kontak_antar_subjek": False,
                "detik_mulai_kontak": None,
                "prediction": "non-bullying",
            }
        )
>>>>>>> fe31edead1edea9f83f1089c3b2f3df2a12f74fd

    contact_outside_clip = (
        max_contact_second is not None
        and result.detik_mulai_kontak is not None
        and result.detik_mulai_kontak > max_contact_second
    )
    insufficient_evidence = (
        result.jumlah_subjek < 2
        or not result.ada_kontak_antar_subjek
        or result.detik_mulai_kontak is None
<<<<<<< HEAD
        or result.jenis_kontak not in AGGRESSIVE_CONTACT_TYPES
=======
        or contact_outside_clip
>>>>>>> fe31edead1edea9f83f1089c3b2f3df2a12f74fd
    )

    if result.prediction == "bullying" and insufficient_evidence:
        return result.model_copy(
            update={
                "prediction": "non-bullying",
                "detik_mulai_kontak": None,
                "reason": (
                    result.reason
                    + " [Auto-koreksi: bukti tidak memenuhi syarat minimum "
                    "bullying.]"
                ),
            }
        )

    if result.prediction == "non-bullying" and result.detik_mulai_kontak is not None:
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

    jenis_kontak_label = result.jenis_kontak.replace("_", " ")

    if result.prediction == "bullying":
<<<<<<< HEAD
        alasan = (
            f"Terdeteksi {result.jumlah_subjek} orang pada {waktu_kejadian:%H:%M:%S} WIB "
            f"(jenis kontak: {jenis_kontak_label}). "
=======
        reason = (
            f"Terdeteksi {result.jumlah_subjek} orang pada "
            f"{occurrence_time_wib:%H:%M:%S} WIB. "
>>>>>>> fe31edead1edea9f83f1089c3b2f3df2a12f74fd
            f"{result.kronologi_kejadian} "
            f"Tingkat keyakinan model: {result.confidence:.0%}."
        )
    elif result.ruangan_kosong:
        reason = (
            f"Tidak ada orang terdeteksi pada {occurrence_time_wib:%H:%M:%S} WIB."
        )
    else:
<<<<<<< HEAD
        if result.ruangan_kosong:
            alasan = f"Tidak ada orang terdeteksi pada {waktu_kejadian:%H:%M:%S} WIB."
        else:
            alasan = (
                f"Terdeteksi {result.jumlah_subjek} orang pada {waktu_kejadian:%H:%M:%S} WIB, "
                f"tidak ada indikasi kontak fisik agresif (jenis kontak: {jenis_kontak_label}). "
                f"{result.kronologi_kejadian} "
                f"Tingkat keyakinan model: {result.confidence:.0%}."
            )
=======
        reason = (
            f"Terdeteksi {result.jumlah_subjek} orang pada "
            f"{occurrence_time_wib:%H:%M:%S} WIB, tidak ada indikasi kontak "
            f"fisik agresif. {result.kronologi_kejadian} "
            f"Tingkat keyakinan model: {result.confidence:.0%}."
        )
>>>>>>> fe31edead1edea9f83f1089c3b2f3df2a12f74fd

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
