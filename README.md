# BRAVE AI CCTV

Repository ini berisi dua aplikasi utama:

- `frontend/` - Next.js PWA untuk monitoring CCTV, rekaman, dan log bullying.
- `backend/` - FastAPI API untuk auth, kamera, rekaman, log bullying, alert, dan WebSocket.

Catatan scope: repo ini tidak mengembangkan model AI. Backend hanya menerima event deteksi dari service eksternal atau data dummy, lalu menyimpan dan menyajikannya ke frontend.

## Struktur

```text
brave-ai-cctv/
  frontend/                 # Next.js app
  backend/                  # FastAPI app
  docker-compose.backend.yml
  AGENTS.md
```

## Menjalankan Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend berjalan di:

```text
http://localhost:3000
```

## Menjalankan Backend

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

Backend docs tersedia di:

```text
http://localhost:8000/docs
```

Atau pakai Docker Compose dari root repo:

```bash
docker compose -f docker-compose.backend.yml up --build
```

Setelah service backend/postgres menyala, jalankan migration dan seed user demo:

```bash
docker compose -f docker-compose.backend.yml exec api alembic upgrade head
docker compose -f docker-compose.backend.yml exec api python -m app.db.seed
```

Demo login:

```text
admin@braveai.school / password
```

## Environment Frontend

Contoh file ada di `frontend/.env.example`:

```env
NEXT_PUBLIC_APP_NAME=BRAVE AI
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api
NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
NEXT_PUBLIC_MEDIA_BASE_URL=http://localhost:8000/media
```