# BRAVE AI CCTV VPS Deploy

Production stack runs fully on the VPS with Docker Compose:

- Caddy reverse proxy + automatic HTTPS
- Next.js frontend
- FastAPI backend
- PostgreSQL
- Redis
- MediaMTX for live stream/HLS/recording gateway
- Recording worker for compressed 24-hour archives with 7-day retention

Current VPS:

```text
148.230.103.197
```

Production domain:

```text
brave-ai.web.id
```

## 1. Domainesia DNS

In Domainesia, open `brave-ai.web.id`, then go to DNS management. Add/update this record:

```text
Type: A
Name/Host: @
Value/Target: 148.230.103.197
TTL: default
```



Wait for DNS propagation. It can be minutes, but sometimes takes longer.

Verify from your laptop:

```powershell
nslookup brave-ai.web.id.
```

The answer should include:

```text
148.230.103.197
```

## 2. VPS firewall

Run on the VPS as `root` if UFW is enabled:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8554/tcp
ufw allow 8888/tcp
ufw allow 8889/tcp
ufw allow 8189/udp
ufw --force enable
```

Ports:

- `80/443`: app + HTTPS certificate challenge through Caddy
- `8554`: RTSP ingest to MediaMTX
- `8888`: direct HLS fallback
- `8889` and `8189/udp`: WebRTC foundation

## 3. Production env on VPS

The VPS must keep `/opt/brave-ai-cctv/.env.production`. This file is intentionally not synced by CI/CD because it contains the database password, application secret, Gemini key, and incident ingest token.

For domain HTTPS, set:

```bash
cd /opt/brave-ai-cctv
sed -i 's/^APP_HOST=.*/APP_HOST=brave-ai.web.id/' .env.production
chmod 600 .env.production
```

Do not change `POSTGRES_PASSWORD` after PostgreSQL has already been initialized unless you also update the database user password.

For centralized Gemini detection, fill these values in `.env.production`:

```dotenv
GEMINI_API_KEY=<server-side-key>
INCIDENT_INGEST_TOKEN=<long-random-token>
AI_DETECTION_ENABLED=true
```

The same `INCIDENT_INGEST_TOKEN` is injected into the API and AI worker by Compose. Keep `AI_DETECTION_ENABLED=false` until the Raspberry Pi stream is stable, then enable it and watch the worker:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build ai-worker api
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f ai-worker
```

## 4. Manual deploy/restart

```bash
cd /opt/brave-ai-cctv
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build --remove-orphans
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api alembic upgrade head
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T api python -m app.db.seed
```

Open:

```text
https://brave-ai.web.id
```

Login production:

```text
admin@braveai.school / <ADMIN_PASSWORD dari .env.production>
gurubk@braveai.school / <VIEWER_PASSWORD dari .env.production>
```

## 5. GitHub Actions CI/CD

Workflow file:

```text
.github/workflows/deploy.yml
```

On every push to `main`, GitHub Actions will:

1. Install frontend dependencies.
2. Run `npx tsc --noEmit`.
3. Compile backend Python files.
4. Validate production Compose config.
5. Sync source to `/opt/brave-ai-cctv` via SSH.
6. Rebuild/restart Docker Compose.
7. Run Alembic migration and seed admin serta Guru BK.

Create these repository secrets in GitHub:

```text
VPS_HOST=148.230.103.197
VPS_USER=root
VPS_SSH_KEY=<contents of C:\Users\Victus\.ssh\brave_ai_cctv_deploy>
APP_DIR=/opt/brave-ai-cctv
```

`VPS_USER` and `APP_DIR` are optional because the workflow defaults to `root` and `/opt/brave-ai-cctv`, but adding them keeps the setup explicit.

Do not put `POSTGRES_PASSWORD` or `SECRET_KEY` in GitHub unless you intentionally want CI to manage the whole `.env.production` file. For this MVP, those secrets stay on the VPS.

## Backup dan ruang disk sebelum demo

Scope lomba cukup memakai satu snapshot PostgreSQL manual sebelum presentasi.
Jalankan dari VPS:

```bash
cd /opt/brave-ai-cctv
sh deploy/check-storage.sh
sh deploy/backup-postgres.sh
ls -lh backups/postgres
```

Skrip backup memverifikasi file dengan `pg_restore --list` dan menjaga snapshot
lokal selama 7 hari. Karena snapshot pada VPS yang sama bukan backup terhadap
kerusakan VPS, salin file terbaru ke laptop sebelum demo:

```powershell
scp root@148.230.103.197:/opt/brave-ai-cctv/backups/postgres/brave-ai-<waktu>.dump .
```

Pemeriksaan storage hanya memberi status `AMAN`, `PERINGATAN`, atau `KRITIS`;
skrip tidak menghentikan kamera maupun menghapus rekaman secara otomatis.
Arsip dan evidence clip aplikasi tetap dibersihkan otomatis setelah 7 hari.

## 6. MediaMTX publish test

From a machine with FFmpeg:

```bash
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 -f lavfi -i anullsrc -c:v libx264 -preset veryfast -tune zerolatency -c:a aac -f rtsp rtsp://brave-ai.web.id:8554/camera-1
```

Watch HLS through HTTPS:

```text
https://brave-ai.web.id/hls/camera-1/index.m3u8
```

Browser webcam publish through HTTPS:

```text
https://brave-ai.web.id/webrtc/camera-1/publish
```

Use this for laptop/phone webcams that must be visible from other logged-in devices. The app's **Jadikan Kamera** button saves the camera as an HLS/MediaMTX source, then opens the matching `/webrtc/{path}/publish` page.

Direct HLS fallback:

```text
http://brave-ai.web.id:8888/camera-1/index.m3u8
```
