#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE=${ENV_FILE:-"$APP_DIR/.env.production"}
COMPOSE_FILE=${COMPOSE_FILE:-"$APP_DIR/docker-compose.prod.yml"}
BACKUP_DIR=${BACKUP_DIR:-"$APP_DIR/backups/postgres"}

if [ ! -f "$ENV_FILE" ]; then
  echo "File environment tidak ditemukan: $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TARGET="$BACKUP_DIR/brave-ai-$STAMP.dump"
TEMP="$TARGET.part"
trap 'rm -f "$TEMP"' EXIT

cd "$APP_DIR"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump --username brave --dbname brave_ai --format custom \
  --no-owner --no-privileges > "$TEMP"

test -s "$TEMP"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_restore --list < "$TEMP" > /dev/null

mv "$TEMP" "$TARGET"
trap - EXIT

# Untuk MVP, cukup simpan snapshot lokal tujuh hari terakhir.
find "$BACKUP_DIR" -type f -name 'brave-ai-*.dump' -mtime +7 -delete

echo "Backup PostgreSQL siap: $TARGET"
echo "Salin file ini ke laptop sebelum demo agar tidak hanya tersimpan di VPS."
