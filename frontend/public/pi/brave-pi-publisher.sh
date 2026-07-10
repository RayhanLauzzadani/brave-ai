#!/usr/bin/env bash
set -Eeuo pipefail

CONFIG_FILE="${1:-/etc/brave-ai-camera.env}"

if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

BRAVE_MEDIA_PATH="${BRAVE_MEDIA_PATH:-camera-1}"
BRAVE_RTSP_HOST="${BRAVE_RTSP_HOST:-brave-ai.web.id}"
BRAVE_RTSP_PORT="${BRAVE_RTSP_PORT:-8554}"
BRAVE_RTSP_URL="${BRAVE_RTSP_URL:-rtsp://${BRAVE_RTSP_HOST}:${BRAVE_RTSP_PORT}/${BRAVE_MEDIA_PATH}}"
VIDEO_DEVICE="${VIDEO_DEVICE:-/dev/video0}"
VIDEO_SIZE="${VIDEO_SIZE:-1280x720}"
FRAMERATE="${FRAMERATE:-25}"
VIDEO_BITRATE="${VIDEO_BITRATE:-2500k}"
VIDEO_CODEC="${VIDEO_CODEC:-libx264}"
PRESET="${PRESET:-veryfast}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is not installed." >&2
  exit 1
fi

if [[ ! -e "$VIDEO_DEVICE" ]]; then
  echo "Video device not found: $VIDEO_DEVICE" >&2
  echo "Run: v4l2-ctl --list-devices" >&2
  exit 1
fi

echo "Starting BRAVE AI Pi publisher"
echo "  device: ${VIDEO_DEVICE}"
echo "  size: ${VIDEO_SIZE}"
echo "  fps: ${FRAMERATE}"
echo "  rtsp: ${BRAVE_RTSP_URL}"

encoder_args=(
  -c:v "$VIDEO_CODEC"
  -pix_fmt yuv420p
  -b:v "$VIDEO_BITRATE"
  -maxrate "$VIDEO_BITRATE"
  -bufsize "$VIDEO_BITRATE"
)

if [[ "$VIDEO_CODEC" == "libx264" ]]; then
  gop_size=$((FRAMERATE * 2))
  encoder_args+=(
    -preset "$PRESET"
    -tune zerolatency
    -g "$gop_size"
    -keyint_min "$gop_size"
    -sc_threshold 0
  )
fi

exec ffmpeg \
  -hide_banner \
  -loglevel info \
  -fflags nobuffer \
  -flags low_delay \
  -f v4l2 \
  -framerate "$FRAMERATE" \
  -video_size "$VIDEO_SIZE" \
  -i "$VIDEO_DEVICE" \
  -an \
  "${encoder_args[@]}" \
  -rtsp_transport tcp \
  -f rtsp \
  "$BRAVE_RTSP_URL"
