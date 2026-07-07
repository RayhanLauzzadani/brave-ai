# BRAVE AI Backend

FastAPI backend starter untuk BRAVE AI CCTV monitoring.

Scope backend ini hanya API dan data management. Model AI tidak dikembangkan di repo ini. Jika ada service AI dari tim lain, service tersebut cukup mengirim event deteksi ke endpoint `incident-events`; backend akan menyimpan log, membuat alert, dan mengirim update ke frontend.

Backend menyiapkan kontrak API untuk:

- Login database PostgreSQL
- Kamera CCTV
- Rekaman 7 hari dan evidence clip
- Log bullying
- Alert/notifikasi
- WebSocket alert real-time
- Ingestion event dari service deteksi eksternal

Login sudah memakai PostgreSQL. Data kamera, rekaman, log bullying, dan alert masih in-memory sampai modul berikutnya dimigrasikan bertahap.

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
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

## Endpoint Awal

```text
GET  /health
POST /api/auth/login
GET  /api/auth/me
GET  /api/cameras
GET  /api/recordings
POST /api/recordings/{recording_id}/clips
GET  /api/bullying-logs
GET  /api/alerts
POST /api/incident-events
WS   /ws/alerts
```

Demo login:

```json
{
  "email": "admin@braveai.school",
  "password": "password"
}
```