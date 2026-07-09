from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.repositories.cameras import list_cameras, to_camera_schema
from app.repositories.reporting import list_evidence_clips, queue_evidence_clip
from app.schemas import EvidenceClipRequest, EvidenceClipResponse, Recording, RecordingSegment
from app.services.recording_segments import get_recording_segment_file, list_recording_segments

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("", response_model=list[Recording])
async def get_recordings(
    camera_id: str | None = Query(default=None, alias="cameraId"),
    date_from: datetime | None = Query(default=None, alias="dateFrom"),
    date_to: datetime | None = Query(default=None, alias="dateTo"),
    has_incident: bool | None = Query(default=None, alias="hasIncident"),
    recording_status: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
) -> list[Recording]:
    return []


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


@router.get("/{recording_id}", response_model=Recording)
async def get_recording_by_id(recording_id: str) -> Recording:
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Rekaman tidak ditemukan",
    )


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
    return await queue_evidence_clip(session, recording_id, request)


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