#!/usr/bin/env bash
set -Eeuo pipefail

MEDIA_PATH=""
RTSP_HOST="brave-ai.web.id"
RTSP_PORT="8554"
VIDEO_DEVICE="/dev/video0"
VIDEO_SIZE="1280x720"
FRAMERATE="25"
VIDEO_BITRATE="2500k"
VIDEO_CODEC="libx264"
PRESET="veryfast"
ASSET_BASE="https://brave-ai.web.id/pi"

usage() {
  cat <<USAGE
BRAVE AI Raspberry Pi Publisher installer

Required:
  --media-path PATH         MediaMTX path, for example koridor-lantai-2

Optional:
  --rtsp-host HOST          MediaMTX host, default brave-ai.web.id
  --rtsp-port PORT          RTSP port, default 8554
  --video-device DEVICE     V4L2 device, default /dev/video0
  --video-size SIZE         Capture size, default 1280x720
  --framerate FPS           Capture FPS, default 25
  --bitrate BITRATE         Video bitrate, default 2500k
  --codec CODEC             ffmpeg encoder, default libx264
  --preset PRESET           ffmpeg preset, default veryfast
  --asset-base URL          Base URL for scripts, default https://brave-ai.web.id/pi

Example:
  curl -fsSL https://brave-ai.web.id/pi/install.sh | sudo bash -s -- --media-path koridor-lantai-2
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --media-path)
      MEDIA_PATH="${2:-}"
      shift 2
      ;;
    --rtsp-host)
      RTSP_HOST="${2:-}"
      shift 2
      ;;
    --rtsp-port)
      RTSP_PORT="${2:-}"
      shift 2
      ;;
    --video-device)
      VIDEO_DEVICE="${2:-}"
      shift 2
      ;;
    --video-size)
      VIDEO_SIZE="${2:-}"
      shift 2
      ;;
    --framerate)
      FRAMERATE="${2:-}"
      shift 2
      ;;
    --bitrate)
      VIDEO_BITRATE="${2:-}"
      shift 2
      ;;
    --codec)
      VIDEO_CODEC="${2:-}"
      shift 2
      ;;
    --preset)
      PRESET="${2:-}"
      shift 2
      ;;
    --asset-base)
      ASSET_BASE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$MEDIA_PATH" ]]; then
  echo "--media-path is required." >&2
  usage
  exit 1
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer with sudo/root." >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This installer expects Raspberry Pi OS / Debian with apt-get." >&2
  exit 1
fi

echo "Installing BRAVE AI Raspberry Pi Publisher..."
apt-get update
apt-get install -y ca-certificates curl ffmpeg v4l-utils

if ! id bravecam >/dev/null 2>&1; then
  useradd --system --no-create-home --groups video,audio bravecam
fi

curl -fsSL "${ASSET_BASE%/}/brave-pi-publisher.sh" -o /usr/local/bin/brave-pi-publisher
chmod 0755 /usr/local/bin/brave-pi-publisher

curl -fsSL "${ASSET_BASE%/}/brave-pi-publisher.service" -o /etc/systemd/system/brave-pi-publisher.service

cat >/etc/brave-ai-camera.env <<EOF
BRAVE_MEDIA_PATH=${MEDIA_PATH}
BRAVE_RTSP_HOST=${RTSP_HOST}
BRAVE_RTSP_PORT=${RTSP_PORT}
VIDEO_DEVICE=${VIDEO_DEVICE}
VIDEO_SIZE=${VIDEO_SIZE}
FRAMERATE=${FRAMERATE}
VIDEO_BITRATE=${VIDEO_BITRATE}
VIDEO_CODEC=${VIDEO_CODEC}
PRESET=${PRESET}
EOF

systemctl daemon-reload
systemctl enable brave-pi-publisher.service
systemctl restart brave-pi-publisher.service

echo
echo "BRAVE AI Pi publisher installed."
echo "Media path: ${MEDIA_PATH}"
echo "RTSP target: rtsp://${RTSP_HOST}:${RTSP_PORT}/${MEDIA_PATH}"
echo "HLS viewer: https://${RTSP_HOST}/hls/${MEDIA_PATH}/index.m3u8"
echo
echo "Check logs:"
echo "  journalctl -u brave-pi-publisher -f"
