from datetime import UTC, datetime
from urllib.parse import quote

import httpx

from app.core.config import get_settings
from app.schemas import CameraConnectionStatus


async def probe_camera_connection(
    camera_id: str,
    media_path: str | None,
) -> CameraConnectionStatus:
    checked_at = datetime.now(UTC)
    if not media_path:
        return CameraConnectionStatus(
            cameraId=camera_id,
            mediaPath=None,
            connected=False,
            status="waiting",
            message="Kamera belum memiliki channel MediaMTX.",
            checkedAt=checked_at,
        )

    settings = get_settings()
    base_url = settings.media_hls_probe_base_url.rstrip("/")
    encoded_path = quote(media_path.strip("/"), safe="/")
    # MediaMTX disk-backed HLS uses a cookie-check redirect. The internal
    # HTTP probe cannot retain its Secure cookie, so request the checked
    # manifest directly.
    manifest_url = f"{base_url}/{encoded_path}/index.m3u8?cookieCheck=1"

    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=settings.media_probe_timeout_seconds,
        ) as client:
            response = await client.get(
                manifest_url,
                headers={
                    "Accept": (
                        "application/vnd.apple.mpegurl, "
                        "application/x-mpegURL, text/plain"
                    )
                },
            )
    except httpx.TimeoutException:
        return CameraConnectionStatus(
            cameraId=camera_id,
            mediaPath=media_path,
            connected=False,
            status="unavailable",
            message="Layanan kamera belum merespons. Coba periksa kembali.",
            checkedAt=checked_at,
        )
    except httpx.RequestError:
        return CameraConnectionStatus(
            cameraId=camera_id,
            mediaPath=media_path,
            connected=False,
            status="unavailable",
            message="Layanan kamera belum dapat dihubungi.",
            checkedAt=checked_at,
        )

    if response.status_code == 200 and "#EXTM3U" in response.text:
        return CameraConnectionStatus(
            cameraId=camera_id,
            mediaPath=media_path,
            connected=True,
            status="live",
            message="Raspberry Pi terhubung. Tayangan siap dibuka.",
            checkedAt=checked_at,
        )

    if response.status_code == 404:
        return CameraConnectionStatus(
            cameraId=camera_id,
            mediaPath=media_path,
            connected=False,
            status="waiting",
            message="Raspberry Pi belum mengirim tayangan ke channel kamera ini.",
            checkedAt=checked_at,
        )

    return CameraConnectionStatus(
        cameraId=camera_id,
        mediaPath=media_path,
        connected=False,
        status="unavailable",
        message="Channel kamera belum dapat diperiksa. Coba beberapa saat lagi.",
        checkedAt=checked_at,
    )
