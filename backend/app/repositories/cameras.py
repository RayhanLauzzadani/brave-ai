from datetime import UTC, datetime
from typing import cast
from urllib.parse import urlparse
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.camera import CameraModel
from app.schemas import Camera, CameraCreate, CameraSourceType, CameraSourceUpdate, CameraStatus


def utc_now() -> datetime:
    return datetime.now(UTC)


def to_camera_schema(camera: CameraModel) -> Camera:
    return Camera(
        id=camera.id,
        name=camera.name,
        location=camera.location,
        status=cast(CameraStatus, camera.status),
        streamUrl=camera.stream_url,
        mediaPath=camera.media_path,
        liveHlsUrl=camera.live_hls_url,
        sourceType=cast(CameraSourceType, camera.source_type),
        thumbnailUrl=camera.thumbnail_url,
        lastActive=camera.last_active,
        isAiEnabled=camera.is_ai_enabled,
    )


async def list_cameras(session: AsyncSession) -> list[CameraModel]:
    result = await session.execute(
        select(CameraModel).order_by(CameraModel.created_at.desc())
    )
    return list(result.scalars().all())


async def get_camera(session: AsyncSession, camera_id: str) -> CameraModel | None:
    result = await session.execute(
        select(CameraModel).where(CameraModel.id == camera_id)
    )
    return result.scalar_one_or_none()


async def create_camera(session: AsyncSession, payload: CameraCreate) -> CameraModel:
    now = utc_now()
    camera = CameraModel(
        id=f"cam-{uuid4().hex[:6]}",
        name=payload.name.strip(),
        location=payload.location.strip(),
        status="offline",
        stream_url=None,
        media_path=None,
        live_hls_url=None,
        source_type=payload.source_type,
        thumbnail_url="/images/cam-placeholder.svg",
        last_active=now,
        is_ai_enabled=payload.is_ai_enabled,
        created_at=now,
        updated_at=now,
    )
    session.add(camera)
    await session.commit()
    await session.refresh(camera)
    return camera


async def delete_camera(session: AsyncSession, camera_id: str) -> bool:
    camera = await get_camera(session, camera_id)
    if not camera:
        return False

    await session.delete(camera)
    await session.commit()
    return True


async def update_camera_source(
    session: AsyncSession,
    camera_id: str,
    payload: CameraSourceUpdate,
) -> CameraModel | None:
    camera = await get_camera(session, camera_id)
    if not camera:
        return None

    stream_url, media_path, live_hls_url = _resolve_camera_stream(payload)
    now = utc_now()
    camera.stream_url = stream_url
    camera.media_path = media_path
    camera.live_hls_url = live_hls_url
    camera.source_type = payload.source_type
    camera.thumbnail_url = payload.thumbnail_url or camera.thumbnail_url
    camera.status = _next_status(camera.status, payload.source_type, stream_url)
    camera.last_active = now
    camera.updated_at = now

    await session.commit()
    await session.refresh(camera)
    return camera


def _next_status(
    current_status: str,
    source_type: CameraSourceType,
    stream_url: str | None,
) -> str:
    if source_type == "mock":
        return "online" if current_status != "offline" else current_status
    if source_type == "local-webcam":
        return "online"
    if source_type in {"hls", "direct-video", "phone-webcam"} and stream_url:
        return "online"
    if source_type in {"rtsp", "nvr", "webrtc"} and stream_url:
        return "online"
    return current_status


def _resolve_camera_stream(
    payload: CameraSourceUpdate,
) -> tuple[str | None, str | None, str | None]:
    stream_url = payload.stream_url.strip() if payload.stream_url else None
    media_path = _normalize_media_path(payload.media_path)

    if payload.source_type != "hls":
        return stream_url, media_path, None

    if stream_url and not _looks_like_url(stream_url):
        media_path = _normalize_media_path(stream_url)
        stream_url = None

    if stream_url and not media_path:
        media_path = _media_path_from_hls_url(stream_url)

    live_hls_url = _build_hls_url(media_path) if media_path else stream_url
    stream_url = stream_url or live_hls_url
    return stream_url, media_path, live_hls_url


def _normalize_media_path(value: str | None) -> str | None:
    if not value:
        return None

    normalized = value.strip().strip("/")
    if not normalized:
        return None

    normalized = normalized.replace("\\", "/")
    if normalized.endswith("/index.m3u8"):
        normalized = normalized[: -len("/index.m3u8")]
    return normalized.strip("/") or None


def _looks_like_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https", "rtsp", "rtmp", "webrtc"}


def _media_path_from_hls_url(stream_url: str) -> str | None:
    parsed = urlparse(stream_url)
    if parsed.scheme not in {"http", "https"}:
        return None

    path = parsed.path.strip("/")
    if path.endswith("/index.m3u8"):
        return _normalize_media_path(path[: -len("/index.m3u8")])
    return None


def _build_hls_url(media_path: str | None) -> str | None:
    if not media_path:
        return None

    base_url = get_settings().media_hls_base_url.rstrip("/")
    return f"{base_url}/{media_path.strip('/')}/index.m3u8"