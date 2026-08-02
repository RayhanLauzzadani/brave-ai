#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
TARGET=${1:-"$APP_DIR/media"}

if [ ! -e "$TARGET" ]; then
  echo "Lokasi media tidak ditemukan: $TARGET" >&2
  exit 1
fi

USAGE=$(df -P "$TARGET" | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }')
AVAILABLE=$(df -hP "$TARGET" | awk 'NR == 2 { print $4 }')

if [ "$USAGE" -lt 70 ]; then
  STATUS="AMAN"
elif [ "$USAGE" -lt 85 ]; then
  STATUS="PERINGATAN"
else
  STATUS="KRITIS"
fi

echo "Status storage: $STATUS"
echo "Terpakai: $USAGE%"
echo "Tersedia: $AVAILABLE"

if [ "$USAGE" -ge 85 ]; then
  echo "Bersihkan rekaman demo lama sebelum menyalakan kamera kembali." >&2
fi
