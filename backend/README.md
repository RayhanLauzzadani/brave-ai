# BRAVE AI Backend

FastAPI backend untuk BRAVE AI CCTV monitoring.

Repo ini tidak melatih model AI. Klasifikasi video memakai Gemini melalui `ai-worker` terpusat di server. Worker mengambil klip 3 detik dari MediaMTX, mengirimnya ke Gemini, lalu meneruskan prediksi bullying yang melewati threshold ke endpoint `incident-events`. API menyimpan log dan alert ke PostgreSQL lalu mengirim pembaruan ke frontend melalui WebSocket.

Backend menyiapkan kontrak API untuk:

- Login database PostgreSQL
- Kamera CCTV
- Arsip per sesi kamera, maksimal 24 jam, dengan masa simpan 7 hari dan evidence clip
- Log bullying
- Alert/notifikasi
- WebSocket alert real-time
- Ingestion event dari worker Gemini atau service deteksi eksternal

Login, kamera, katalog arsip rekaman, log bullying, alert, dan metadata evidence clip sudah memakai PostgreSQL. Segmen mentah, MP4 arsip, dan hasil evidence clip disimpan pada volume media.

Arsip rekaman dan evidence clip memakai retensi 7 hari untuk scope MVP. API
menjalankan cleanup evidence clip setiap jam; interval dan retensinya dapat
diubah melalui `EVIDENCE_CLIP_CLEANUP_POLL_SECONDS` dan
`EVIDENCE_CLIP_RETENTION_DAYS`.

## Menjalankan Lokal

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -e .
copy .env.example .env
alembic upgrade head
python -m app.db.seed
uvicorn app.main:app --reload --port 8000
```

API docs tersedia di:

```text
http://localhost:8000/docs
```

## Menjalankan Dengan Docker Compose

Dari root repo:

```bash
docker compose -f docker-compose.backend.yml up --build
```

Lalu jalankan migration dan seed dari terminal lain:

```bash
docker compose -f docker-compose.backend.yml exec api alembic upgrade head
docker compose -f docker-compose.backend.yml exec api python -m app.db.seed
```

Service yang tersedia:

- API: `http://localhost:8000`
- Recording worker: finalisasi sesi saat kamera berhenti atau mencapai 24 jam
- AI worker: proses background, default nonaktif
- MediaMTX: RTSP `localhost:8554`, HLS `localhost:8888`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## Mengaktifkan Deteksi Gemini

Simpan secret pada environment mesin, bukan source code. Dari PowerShell:

```powershell
$env:GEMINI_API_KEY="<api-key-baru>"
$env:INCIDENT_INGEST_TOKEN="<random-token-yang-sama-untuk-api-dan-worker>"
$env:AI_DETECTION_ENABLED="true"
docker compose -f docker-compose.backend.yml up --build
```

Worker hanya membaca kamera dengan `isAiEnabled=true` dan `mediaPath` aktif. Alurnya:

```text
Raspberry Pi -> MediaMTX RTSP -> ai-worker -> Gemini
             -> POST /api/incident-events -> PostgreSQL + WebSocket
```

Prediksi `non-bullying` atau confidence di bawah `AI_DETECTION_CONFIDENCE_THRESHOLD` tidak membuat laporan. Prediksi yang lolos tetap berstatus verifikasi `pending` agar guru menentukan bullying atau bukan. Worker memberi setiap event `eventId` stabil, menunda capture baru saat antrean penuh, dan melewati klip yang lebih tua dari `AI_DETECTION_MAX_CLIP_AGE_SECONDS` agar notifikasi tidak muncul beberapa menit setelah kejadian. Pengiriman incident tetap dicoba ulang sebelum cooldown dimulai. Jumlah percobaan dan jedanya dapat diatur melalui `INCIDENT_REQUEST_MAX_ATTEMPTS` dan `INCIDENT_REQUEST_RETRY_BASE_SECONDS`. Gunakan `docker compose -f docker-compose.backend.yml logs -f ai-worker` untuk melihat status worker. Karena setiap klip memanggil API eksternal, pantau kuota Gemini sebelum mengaktifkannya untuk banyak kamera selama 24 jam.

## Evaluasi Dataset Gemini

Benchmark dataset berjalan lewat service Compose profile `evaluation` dan tidak
membuat laporan production. Panduan dataset, dry run, pilot, cache/resume, dan
format report ada di [docs/ai-evaluation/README.md](../docs/ai-evaluation/README.md).

## Endpoint Awal

```text
GET  /health
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout
GET  /api/cameras
GET  /api/recordings
GET  /api/recordings/{recording_id}/media
POST /api/recordings/{recording_id}/clips
GET  /api/bullying-logs
PATCH /api/bullying-logs/{log_id}/verification
GET  /api/alerts
GET  /api/reports
PATCH /api/reports/{report_id}
POST /api/incident-events
WS   /ws/alerts
```

Setiap incident baru memiliki `verificationStatus: pending`. Validasi dikirim dengan `{"verification":"bullying"}` atau `{"verification":"not-bullying"}`; log tidak dihapus ketika ditandai bukan bullying.

Login development:

```text
admin@braveai.school / password
gurubk@braveai.school / password
```

Endpoint login memasang JWT pada cookie `HttpOnly`. Password production
diambil dari `ADMIN_PASSWORD` dan `VIEWER_PASSWORD`, bukan dari nilai demo.
