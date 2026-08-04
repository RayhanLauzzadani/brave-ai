from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

import httpx
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import Settings, get_settings
from app.db.session import AsyncSessionLocal
from app.repositories.cameras import list_cameras, to_camera_schema
from app.schemas import Camera, IncidentEventCreate
from app.services.gemini_classifier import (
    GeminiClassification,
    GeminiVideoClassifier,
)

logger = logging.getLogger("brave-ai.gemini-worker")


@dataclass(frozen=True)
class CapturedClip:
    camera: Camera
    path: Path
    occurred_at: datetime


@dataclass(frozen=True)
class IncidentDeliveryLease:
    camera_id: str
    token: str
    redis_managed: bool


_LOCAL_INCIDENT_PENDING: set[str] = set()
_LOCAL_INCIDENT_COOLDOWNS: dict[str, float] = {}


class CameraCaptureError(RuntimeError):
    pass


async def run_detection_worker(settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    if not settings.ai_detection_enabled:
        logger.warning(
            "AI detection worker disabled. Set AI_DETECTION_ENABLED=true to enable it."
        )
        await asyncio.Event().wait()

    if not settings.gemini_api_key:
        raise RuntimeError("AI_DETECTION_ENABLED=true tetapi GEMINI_API_KEY kosong.")

    classifier = GeminiVideoClassifier(settings=settings)
    queue: asyncio.Queue[CapturedClip] = asyncio.Queue(
        maxsize=max(1, settings.ai_detection_queue_size)
    )
    redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
    event_client = httpx.AsyncClient(timeout=settings.incident_request_timeout_seconds)
    consumers = [
        asyncio.create_task(
            _consume_clips(queue, classifier, redis_client, event_client, settings),
            name=f"gemini-consumer-{index}",
        )
        for index in range(max(1, settings.ai_detection_max_concurrency))
    ]
    producers: dict[str, asyncio.Task[None]] = {}

    try:
        while True:
            try:
                cameras = await _load_detection_cameras()
            except Exception:
                logger.exception("Kamera AI belum dapat dimuat dari PostgreSQL.")
                cameras = None

            if cameras is not None:
                active_ids = {camera.id for camera in cameras}
                for camera_id, task in list(producers.items()):
                    if camera_id not in active_ids:
                        task.cancel()
                        producers.pop(camera_id, None)

                for camera in cameras:
                    task = producers.get(camera.id)
                    if task is None or task.done():
                        producers[camera.id] = asyncio.create_task(
                            _produce_camera(camera, queue, settings),
                            name=f"gemini-camera-{camera.id}",
                        )

            await asyncio.sleep(max(2, settings.ai_detection_camera_refresh_seconds))
    finally:
        for task in producers.values():
            task.cancel()
        for task in consumers:
            task.cancel()
        await asyncio.gather(*producers.values(), *consumers, return_exceptions=True)
        _discard_pending_queue(queue)
        await event_client.aclose()
        await redis_client.aclose()


async def _load_detection_cameras() -> list[Camera]:
    async with AsyncSessionLocal() as session:
        models = await list_cameras(session)
    return [
        to_camera_schema(camera)
        for camera in models
        if camera.is_ai_enabled and camera.media_path
    ]


async def _produce_camera(
    camera: Camera,
    queue: asyncio.Queue[CapturedClip],
    settings: Settings,
) -> None:
    interval = max(1.0, settings.ai_detection_interval_seconds)
    while True:
        started = time.monotonic()
        clip_path: Path | None = None
        try:
            clip_path = await capture_camera_clip(camera, settings)
            captured_at = datetime.now(UTC)
            occurred_at = captured_at - timedelta(
                seconds=max(1, settings.ai_detection_clip_seconds) / 2
            )
            item = CapturedClip(camera=camera, path=clip_path, occurred_at=occurred_at)
            if queue.full():
                logger.warning(
                    "Queue AI penuh; kamera %s menunggu kapasitas pemrosesan.",
                    camera.id,
                )
            await queue.put(item)
            clip_path = None
        except asyncio.CancelledError:
            if clip_path:
                _discard_clip(clip_path)
            raise
        except (CameraCaptureError, OSError) as error:
            logger.warning("Kamera %s belum bisa diambil: %s", camera.name, error)
        except Exception:
            logger.exception("Producer AI kamera %s gagal.", camera.id)
        finally:
            if clip_path:
                _discard_clip(clip_path)

        elapsed = time.monotonic() - started
        await asyncio.sleep(max(0.0, interval - elapsed))


async def capture_camera_clip(camera: Camera, settings: Settings) -> Path:
    if not camera.media_path:
        raise CameraCaptureError("Kamera belum memiliki media path.")

    file_descriptor, file_name = tempfile.mkstemp(
        prefix=f"brave-ai-{camera.id}-",
        suffix=".mp4",
    )
    os.close(file_descriptor)
    output_path = Path(file_name)
    command = build_capture_command(camera, settings, output_path)

    try:
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=max(10.0, settings.ai_detection_capture_timeout_seconds),
            )
        except TimeoutError as error:
            process.kill()
            await process.communicate()
            raise CameraCaptureError("FFmpeg timeout saat mengambil klip kamera.") from error

        if process.returncode != 0:
            detail = stderr.decode("utf-8", errors="replace").strip()[-500:]
            raise CameraCaptureError(detail or "FFmpeg gagal membaca stream RTSP.")
        if not output_path.is_file() or output_path.stat().st_size < 1024:
            raise CameraCaptureError("FFmpeg menghasilkan klip kosong.")
        if output_path.stat().st_size > settings.gemini_inline_max_bytes:
            raise CameraCaptureError("Klip hasil capture melebihi batas ukuran Gemini.")
        return output_path
    except FileNotFoundError as error:
        raise CameraCaptureError(
            f"Binary FFmpeg tidak ditemukan: {settings.ffmpeg_binary}"
        ) from error
    except Exception:
        _discard_clip(output_path)
        raise


def build_capture_command(
    camera: Camera,
    settings: Settings,
    output_path: Path,
) -> list[str]:
    if not camera.media_path:
        raise CameraCaptureError("Kamera belum memiliki media path.")

    base_url = settings.ai_detection_rtsp_base_url.rstrip("/")
    encoded_path = quote(camera.media_path.strip("/"), safe="/-_.")
    return [
        settings.ffmpeg_binary,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-rtsp_transport",
        "tcp",
        "-timeout",
        "8000000",
        "-i",
        f"{base_url}/{encoded_path}",
        "-t",
        str(max(1, settings.ai_detection_clip_seconds)),
        "-an",
        "-vf",
        f"fps={settings.gemini_video_fps:g},scale=640:-2",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-crf",
        "28",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-y",
        str(output_path),
    ]


async def _consume_clips(
    queue: asyncio.Queue[CapturedClip],
    classifier: GeminiVideoClassifier,
    redis_client: Redis,
    event_client: httpx.AsyncClient,
    settings: Settings,
) -> None:
    while True:
        clip = await queue.get()
        try:
            await _classify_and_report(
                clip,
                classifier,
                redis_client,
                event_client,
                settings,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Klip AI kamera %s gagal diproses.", clip.camera.id)
        finally:
            _discard_clip(clip.path)
            queue.task_done()


async def _classify_and_report(
    clip: CapturedClip,
    classifier: GeminiVideoClassifier,
    redis_client: Redis,
    event_client: httpx.AsyncClient,
    settings: Settings,
) -> None:
    video_bytes = await asyncio.to_thread(clip.path.read_bytes)
    result = await classifier.classify(video_bytes)
    logger.info(
        "Gemini kamera %s: %s (%.2f).",
        clip.camera.name,
        result.prediction,
        result.confidence,
    )
    if not should_emit_prediction(result, settings.ai_detection_confidence_threshold):
        return

    lease = await _claim_incident_delivery(redis_client, clip.camera.id, settings)
    if lease is None:
        logger.debug("Incident kamera %s masih dalam cooldown.", clip.camera.id)
        return

    payload = IncidentEventCreate(
        eventId=build_incident_event_id(clip, video_bytes),
        cameraId=clip.camera.id,
        cameraName=clip.camera.name,
        bullyType="physical",
        severity=severity_for_confidence(result.confidence),
        confidence=result.confidence,
        description=build_incident_description(result),
        occurredAt=clip.occurred_at,
        thumbnailUrl=clip.camera.thumbnail_url,
    )
    try:
        await _post_incident(event_client, payload, settings)
    except Exception:
        await _release_incident_delivery(redis_client, lease)
        raise

    await _complete_incident_delivery(redis_client, lease, settings)
    logger.info(
        "Incident bullying dikirim untuk %s dengan confidence %.2f.",
        clip.camera.name,
        result.confidence,
    )


def should_emit_prediction(result: GeminiClassification, threshold: float) -> bool:
    return result.prediction == "bullying" and result.confidence >= threshold


def severity_for_confidence(confidence: float) -> str:
    if confidence >= 0.95:
        return "critical"
    if confidence >= 0.85:
        return "high"
    return "medium"


def build_incident_description(result: GeminiClassification) -> str:
    return (
        f"{result.reason} "
        f"Observasi: {result.observasi_gerakan} "
        f"Analisis kontak fisik: {result.analisis_kontak_fisik}"
    )[:4000]


def build_incident_event_id(clip: CapturedClip, video_bytes: bytes) -> str:
    digest = sha256()
    digest.update(clip.camera.id.encode("utf-8"))
    digest.update(b":")
    digest.update(clip.occurred_at.isoformat().encode("ascii"))
    digest.update(b":")
    digest.update(video_bytes)
    return f"gemini-{digest.hexdigest()[:40]}"


async def _post_incident(
    client: httpx.AsyncClient,
    payload: IncidentEventCreate,
    settings: Settings,
) -> None:
    headers: dict[str, str] = {}
    if settings.incident_ingest_token:
        headers["X-Brave-Ingest-Token"] = settings.incident_ingest_token
    if payload.event_id:
        headers["Idempotency-Key"] = payload.event_id

    url = settings.incident_api_base_url.rstrip("/") + "/incident-events"
    request_body = payload.model_dump(mode="json", by_alias=True, exclude_none=True)
    max_attempts = max(1, settings.incident_request_max_attempts)

    for attempt in range(1, max_attempts + 1):
        response: httpx.Response | None = None
        try:
            response = await client.post(
                url,
                headers=headers,
                json=request_body,
            )
        except httpx.RequestError as error:
            if attempt >= max_attempts:
                raise RuntimeError(
                    "API incident event tidak dapat dihubungi setelah retry."
                ) from error
            logger.warning(
                "Pengiriman incident gagal pada percobaan %s/%s: %s",
                attempt,
                max_attempts,
                error,
            )
        else:
            if response.status_code in {200, 201}:
                return
            retryable = (
                response.status_code in {408, 425, 429}
                or response.status_code >= 500
            )
            if not retryable or attempt >= max_attempts:
                raise RuntimeError(
                    f"API incident event mengembalikan HTTP {response.status_code}."
                )
            logger.warning(
                "API incident mengembalikan HTTP %s pada percobaan %s/%s.",
                response.status_code,
                attempt,
                max_attempts,
            )

        await asyncio.sleep(_incident_retry_delay(response, attempt, settings))


def _incident_retry_delay(
    response: httpx.Response | None,
    attempt: int,
    settings: Settings,
) -> float:
    retry_after = response.headers.get("Retry-After") if response is not None else None
    if retry_after:
        try:
            return max(0.0, min(float(retry_after), 30.0))
        except ValueError:
            pass
    base_delay = max(0.05, settings.incident_request_retry_base_seconds)
    return min(base_delay * (2 ** max(0, attempt - 1)), 10.0)


async def _claim_incident_delivery(
    redis_client: Redis,
    camera_id: str,
    settings: Settings,
) -> IncidentDeliveryLease | None:
    now = time.monotonic()
    cooldown_until = _LOCAL_INCIDENT_COOLDOWNS.get(camera_id, 0.0)
    if cooldown_until > now or camera_id in _LOCAL_INCIDENT_PENDING:
        return None
    if cooldown_until:
        _LOCAL_INCIDENT_COOLDOWNS.pop(camera_id, None)

    _LOCAL_INCIDENT_PENDING.add(camera_id)
    token = uuid4().hex
    cooldown_key = _incident_cooldown_key(camera_id)
    pending_key = _incident_pending_key(camera_id)
    lease_seconds = _incident_delivery_lease_seconds(settings)
    redis_managed = False
    try:
        if await redis_client.exists(cooldown_key):
            _LOCAL_INCIDENT_PENDING.discard(camera_id)
            return None
        result = await redis_client.set(
            pending_key,
            token,
            ex=lease_seconds,
            nx=True,
        )
        if not result:
            _LOCAL_INCIDENT_PENDING.discard(camera_id)
            return None
        redis_managed = True
        if await redis_client.exists(cooldown_key):
            await _delete_owned_pending_key(redis_client, pending_key, token)
            _LOCAL_INCIDENT_PENDING.discard(camera_id)
            return None
    except RedisError:
        logger.warning(
            "Redis cooldown tidak tersedia; memakai lock lokal worker AI."
        )

    return IncidentDeliveryLease(
        camera_id=camera_id,
        token=token,
        redis_managed=redis_managed,
    )


async def _complete_incident_delivery(
    redis_client: Redis,
    lease: IncidentDeliveryLease,
    settings: Settings,
) -> None:
    cooldown_seconds = max(1, settings.ai_detection_cooldown_seconds)
    _LOCAL_INCIDENT_COOLDOWNS[lease.camera_id] = (
        time.monotonic() + cooldown_seconds
    )
    if lease.redis_managed:
        try:
            await redis_client.set(
                _incident_cooldown_key(lease.camera_id),
                "1",
                ex=cooldown_seconds,
            )
        except RedisError:
            logger.warning(
                "Cooldown Redis gagal disimpan; cooldown lokal tetap aktif."
            )
    await _release_incident_delivery(redis_client, lease)


async def _release_incident_delivery(
    redis_client: Redis,
    lease: IncidentDeliveryLease,
) -> None:
    _LOCAL_INCIDENT_PENDING.discard(lease.camera_id)
    if not lease.redis_managed:
        return
    try:
        await _delete_owned_pending_key(
            redis_client,
            _incident_pending_key(lease.camera_id),
            lease.token,
        )
    except RedisError:
        logger.warning(
            "Lock pengiriman incident akan dilepas otomatis setelah TTL."
        )


async def _delete_owned_pending_key(
    redis_client: Redis,
    key: str,
    token: str,
) -> None:
    if await redis_client.get(key) == token:
        await redis_client.delete(key)


def _incident_cooldown_key(camera_id: str) -> str:
    return f"brave:ai:incident-cooldown:{camera_id}"


def _incident_pending_key(camera_id: str) -> str:
    return f"brave:ai:incident-pending:{camera_id}"


def _incident_delivery_lease_seconds(settings: Settings) -> int:
    attempts = max(1, settings.incident_request_max_attempts)
    timeout_budget = max(1.0, settings.incident_request_timeout_seconds) * attempts
    retry_budget = max(0.05, settings.incident_request_retry_base_seconds) * (
        (2**attempts) - 1
    )
    return max(30, int(timeout_budget + retry_budget) + 10)


def _discard_clip(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.debug("Klip sementara %s belum dapat dihapus.", path)


def _discard_pending_queue(queue: asyncio.Queue[CapturedClip]) -> None:
    while not queue.empty():
        clip = queue.get_nowait()
        _discard_clip(clip.path)
        queue.task_done()


async def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    await run_detection_worker()


if __name__ == "__main__":
    asyncio.run(main())
