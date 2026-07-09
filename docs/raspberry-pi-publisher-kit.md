# BRAVE AI Raspberry Pi Publisher Kit

This kit turns a Raspberry Pi with a USB webcam or V4L2 camera into a 24/7 BRAVE AI camera source.

## Architecture

```text
Raspberry Pi webcam
  -> ffmpeg RTSP publish
  -> MediaMTX on VPS
  -> HLS playback in BRAVE AI Live Camera
  -> MediaMTX recording segments for Recording View
```

Raspberry Pi is the camera device. MediaMTX is still the media gateway on the VPS.

## 1. Prepare camera in BRAVE AI

1. Open `/live-view`.
2. Select or create a camera.
3. Use **Copy Pi** in the **Sumber Video** panel.
4. The app will copy an install command with the selected camera media path.

The copied command looks like this:

```bash
curl -fsSL https://brave-ai.web.id/pi/install.sh | sudo bash -s -- --media-path koridor-lantai-2 --rtsp-host brave-ai.web.id --asset-base https://brave-ai.web.id/pi
```

## 2. Run on Raspberry Pi

SSH into the Raspberry Pi and run the copied command:

```bash
ssh pi@RASPBERRY_PI_IP
curl -fsSL https://brave-ai.web.id/pi/install.sh | sudo bash -s -- --media-path koridor-lantai-2 --rtsp-host brave-ai.web.id --asset-base https://brave-ai.web.id/pi
```

The installer will:

- install `ffmpeg`, `v4l-utils`, `curl`, and CA certificates,
- create the `bravecam` system user,
- install `/usr/local/bin/brave-pi-publisher`,
- create `/etc/brave-ai-camera.env`,
- install and start `brave-pi-publisher.service`.

## 3. Useful commands

List camera devices:

```bash
v4l2-ctl --list-devices
```

Check service status:

```bash
systemctl status brave-pi-publisher
```

Watch logs:

```bash
journalctl -u brave-pi-publisher -f
```

Restart publisher:

```bash
sudo systemctl restart brave-pi-publisher
```

Edit config:

```bash
sudo nano /etc/brave-ai-camera.env
sudo systemctl restart brave-pi-publisher
```

## 4. Configuration

`/etc/brave-ai-camera.env`:

```ini
BRAVE_MEDIA_PATH=koridor-lantai-2
BRAVE_RTSP_HOST=brave-ai.web.id
BRAVE_RTSP_PORT=8554
VIDEO_DEVICE=/dev/video0
VIDEO_SIZE=1280x720
FRAMERATE=25
VIDEO_BITRATE=2500k
VIDEO_CODEC=libx264
PRESET=veryfast
```

For lower CPU usage on some Raspberry Pi models, try:

```ini
VIDEO_CODEC=h264_v4l2m2m
```

Then restart:

```bash
sudo systemctl restart brave-pi-publisher
```

## 5. Troubleshooting

If the camera is not detected:

```bash
v4l2-ctl --list-devices
ls -la /dev/video*
```

If Live Camera is black:

1. Check Pi logs with `journalctl -u brave-pi-publisher -f`.
2. Check the MediaMTX path:

```text
https://brave-ai.web.id/hls/<media-path>/index.m3u8
```

3. Ensure VPS firewall allows RTSP port `8554`.
4. Ensure the camera in BRAVE AI uses the same media path.

If CPU is too high:

- reduce `VIDEO_SIZE` to `854x480`,
- reduce `FRAMERATE` to `15`,
- reduce `VIDEO_BITRATE` to `1200k`,
- try `VIDEO_CODEC=h264_v4l2m2m`.

## 6. Current security note

This MVP publishes to the open MediaMTX RTSP port. Before real production, add publish authentication/token rules in MediaMTX and generate per-camera tokens from the backend.
