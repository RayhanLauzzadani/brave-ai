# BRAVE AI CCTV

Repository ini berisi dua aplikasi utama:

- `frontend/` - Next.js PWA untuk monitoring CCTV, rekaman, dan log bullying.
- `backend/` - FastAPI API untuk auth, kamera, rekaman, log bullying, alert, dan WebSocket.
- `media/` - konfigurasi MediaMTX dan output recording segment lokal.

Catatan scope: repo ini tidak mengembangkan model AI. Backend hanya menerima event deteksi dari service eksternal atau data dummy, lalu menyimpan dan menyajikannya ke frontend.

## Struktur

```text
brave-ai-cctv/
  frontend/                 # Next.js app
  backend/                  # FastAPI app
  media/                    # MediaMTX config + local recording output
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

Untuk akses dari HP/laptop lain di jaringan WiFi yang sama:

```bash
cd frontend
npm run dev:lan
```

Lalu buka URL network yang ditampilkan Next.js, misalnya:

```text
http://192.168.110.211:3000
```

Untuk demo webcam HP/PWA, browser membutuhkan secure context. Jalankan mode HTTPS dev:

```bash
cd frontend
npm run dev:https
```

Jika IP auto-detect salah, set manual dulu:

```powershell
$env:LAN_HOST="192.168.110.211"
npm run dev:https
```

Lalu buka:

```text
https://192.168.110.211:3000
```

Catatan: script `npm run dev:https` membuat sertifikat self-signed dengan SAN `localhost` dan IP LAN laptop. Di HP/browser, kamu mungkin perlu membuka Advanced/Continue atau memakai sertifikat/tunnel HTTPS yang dipercaya. Jika kamera masih ditolak, berarti origin belum dianggap secure oleh browser.

Secara default frontend memanggil backend lewat same-origin `/api`, lalu Next.js mem-proxy ke FastAPI (`BACKEND_ORIGIN`, default `http://127.0.0.1:8000`). Untuk akses LAN/HTTPS, jangan set `NEXT_PUBLIC_API_BASE_URL` kecuali memang ingin bypass proxy.

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

## Menjalankan Media Gateway

Media gateway memakai MediaMTX untuk menerima stream kamera, menyiapkan HLS/WebRTC playback, dan merekam segment server-side.

Jalankan bersama backend dari root repo:

```bash
docker compose -f docker-compose.backend.yml up --build
```

Port MediaMTX lokal:

```text
RTSP ingest/read : rtsp://localhost:8554/{path}
HLS playback    : http://localhost:8888/{path}/index.m3u8
WebRTC endpoint : http://localhost:8889
Playback API    : http://localhost:9996
Control API     : http://localhost:9997
```

Contoh publish stream test jika FFmpeg tersedia:

```bash
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 -f lavfi -i anullsrc -c:v libx264 -preset veryfast -tune zerolatency -c:a aac -f rtsp rtsp://localhost:8554/camera-1
```

Lalu di Live Camera, simpan source kamera sebagai HLS:

```text
http://localhost:8888/camera-1/index.m3u8
```

Recording segment lokal akan masuk ke `media/recordings/` dan tidak ikut Git.

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

# Default frontend API uses same-origin /api and is proxied by next.config.ts.
# Only set these when you intentionally want to bypass the Next proxy.
# NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api
# NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws
# NEXT_PUBLIC_MEDIA_BASE_URL=http://localhost:8000/media

# Next.js dev proxy target.
BACKEND_ORIGIN=http://127.0.0.1:8000
LAN_HOST=192.168.110.211
```
