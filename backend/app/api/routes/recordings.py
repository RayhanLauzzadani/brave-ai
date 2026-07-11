from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db_session
from app.repositories.cameras import list_cameras, to_camera_schema
from app.repositories.reporting import (
    get_evidence_clip,
    list_bullying_logs,
    list_evidence_clips,
    queue_evidence_clip,
)
from app.schemas import EvidenceClipRequest, EvidenceClipResponse, Recording, RecordingSegment
from app.services.evidence_clips import get_evidence_clip_file, schedule_evidence_clip
from app.services.recording_catalog import build_recordings, filter_recordings
from app.services.recording_segments import get_recording_segment_file, list_recording_segments

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db_session)]
settings = get_settings()


@router.get("", response_model=list[Recording])
async def get_recordings(
    session: DbSession,
    camera_id: str | None = Query(default=None, alias="cameraId"),
    date_from: datetime | None = Query(default=None, alias="dateFrom"),
    date_to: datetime | None = Query(default=None, alias="dateTo"),
    has_incident: bool | None = Query(default=None, alias="hasIncident"),
    recording_status: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
) -> list[Recording]:
    recordings = await _list_gateway_recordings(
        session,
        camera_id=camera_id,
        date_from=date_from,
        date_to=date_to,
    )
    return filter_recordings(
        recordings,
        has_incident=has_incident,
        recording_status=recording_status,
        search=search,
        offset=offset,
        limit=limit,
    )


@router.get("/segments", response_model=list[RecordingSegment])
async def get_recording_segments(
    session: DbSession,
    camera_id: str | None = Query(default=None, alias="cameraId"),
    media_path: str | None = Query(default=None, alias="mediaPath"),
    date_from: datetime | None = Query(default=None, alias="dateFrom"),
    date_to: datetime | None = Query(default=None, alias="dateTo"),
) -> list[RecordingSegment]:
    cameras = [to_camera_schema(camera) for camera in await list_cameras(session)]
    return list_recording_segments(
        camera_id=camera_id,
        media_path=media_path,
        date_from=date_from,
        date_to=date_to,
        cameras=cameras,
    )


@router.get("/segments/{segment_id}/media")
async def get_recording_segment_media(segment_id: str) -> FileResponse:
    file_path = get_recording_segment_file(segment_id)
    if file_path is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Segment rekaman tidak ditemukan",
        )

    return FileResponse(
        path=file_path,
        media_type=_recording_media_type(file_path.suffix),
    )


@router.get("/clips/{clip_id}/media")
async def get_evidence_clip_media(clip_id: str, session: DbSession) -> FileResponse:
    clip = await get_evidence_clip(session, clip_id)
    file_path = get_evidence_clip_file(clip_id)
    if clip is None or clip.status != "ready" or file_path is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Klip bukti belum tersedia",
        )

    return FileResponse(
        path=file_path,
        media_type="video/mp4",
        filename=f"brave-ai-{clip_id}.mp4",
        headers={"Cache-Control": "private, no-store"},
    )

@router.get("/{recording_id}", response_model=Recording)
async def get_recording_by_id(recording_id: str, session: DbSession) -> Recording:
    recordings = await _list_gateway_recordings(session)
    recording = next((item for item in recordings if item.id == recording_id), None)
    if recording is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rekaman tidak ditemukan",
        )
    return recording


@router.get("/{recording_id}/clips", response_model=list[EvidenceClipResponse])
async def get_evidence_clips(
    recording_id: str,
    session: DbSession,
) -> list[EvidenceClipResponse]:
    return await list_evidence_clips(session, recording_id)


@router.post("/{recording_id}/clips", response_model=EvidenceClipResponse)
async def create_evidence_clip(
    recording_id: str,
    request: EvidenceClipRequest,
    session: DbSession,
) -> EvidenceClipResponse:
    duration_seconds = (request.end_time - request.start_time).total_seconds()
    if duration_seconds <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Waktu akhir klip harus setelah waktu awal",
        )
    if duration_seconds > settings.evidence_clip_max_duration_seconds:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Durasi klip maksimal "
                f"{settings.evidence_clip_max_duration_seconds} detik"
            ),
        )

    recordings = await _list_gateway_recordings(
        session,
        camera_id=request.camera_id,
        date_from=request.start_time,
        date_to=request.end_time,
    )
    recording = next((item for item in recordings if item.id == recording_id), None)
    if recording is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rekaman sumber tidak ditemukan pada rentang waktu tersebut",
        )

    clip = await queue_evidence_clip(session, recording_id, request)
    schedule_evidence_clip(clip.id)
    return clip


async def _list_gateway_recordings(
    session: AsyncSession,
    *,
    camera_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[Recording]:
    cameras = [to_camera_schema(camera) for camera in await list_cameras(session)]
    segments = list_recording_segments(
        camera_id=camera_id,
        date_from=date_from,
        date_to=date_to,
        cameras=cameras,
    )
    logs = await list_bullying_logs(session)
    return build_recordings(segments, cameras, logs)


def _recording_media_type(suffix: str) -> str:
    match suffix.lower():
        case ".mp4" | ".m4s":
            return "video/mp4"
        case ".ts":
            return "video/mp2t"
        case ".mkv":
            return "video/x-matroska"
        case _:
            return "application/octet-stream"