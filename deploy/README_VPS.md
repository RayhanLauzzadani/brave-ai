# BRAVE AI CCTV VPS Deploy

Production stack runs fully on the VPS with Docker Compose:

- Caddy reverse proxy + automatic HTTPS
- Next.js frontend
- FastAPI backend
- PostgreSQL
- Redis
- MediaMTX for live stream/HLS/recording gateway

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

The VPS must keep `/opt/brave-ai-cctv/.env.production`. This file is intentionally not synced by CI/CD because it contains the real database password and secret key.

For domain HTTPS, set:

```bash
cd /opt/brave-ai-cctv
sed -i 's/^APP_HOST=.*/APP_HOST=brave-ai.web.id/' .env.production
chmod 600 .env.production
```

Do not change `POSTGRES_PASSWORD` after PostgreSQL has already been initialized unless you also update the database user password.

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

Demo login:

```text
admin@braveai.school / password
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
7. Run Alembic migration and seed admin user.

Create these repository secrets in GitHub:

```text
VPS_HOST=148.230.103.197
VPS_USER=root
VPS_SSH_KEY=<contents of C:\Users\Victus\.ssh\brave_ai_cctv_deploy>
APP_DIR=/opt/brave-ai-cctv
```

`VPS_USER` and `APP_DIR` are optional because the workflow defaults to `root` and `/opt/brave-ai-cctv`, but adding them keeps the setup explicit.

Do not put `POSTGRES_PASSWORD` or `SECRET_KEY` in GitHub unless you intentionally want CI to manage the whole `.env.production` file. For this MVP, those secrets stay on the VPS.

## 6. MediaMTX publish test

From a machine with FFmpeg:

```bash
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 -f lavfi -i anullsrc -c:v libx264 -preset veryfast -tune zerolatency -c:a aac -f rtsp rtsp://brave-ai.web.id:8554/camera-1
```

Watch HLS through HTTPS:

```text
https://brave-ai.web.id/hls/camera-1/index.m3u8
```

Direct HLS fallback:

```text
http://brave-ai.web.id:8888/camera-1/index.m3u8
```