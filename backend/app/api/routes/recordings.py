from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import AdminUser, CurrentUser
from app.core.config import get_settings
from app.db.session import get_db_session
from app.repositories.cameras import list_cameras, to_camera_schema
from app.repositories.recordings import (
    get_recording_model,
    list_ready_recording_models,
    to_recording_schema,
)
from app.repositories.reporting import (
    get_evidence_clip,
    list_bullying_logs,
    list_evidence_clips,
    queue_evidence_clip,
)
from app.schemas import (
    EvidenceClipRequest,
    EvidenceClipResponse,
    Recording,
    RecordingSegment,
)
from app.services.evidence_clips import get_evidence_clip_file, schedule_evidence_clip
from app.services.recording_archiver import resolve_archive_file
from app.services.recording_catalog import filter_recordings
from app.services.recording_segments import (
    get_recording_segment_file,
    list_recording_segments,
)

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db_session)]
settings = get_settings()


@router.get("", response_model=list[Recording])
async def get_recordings(
    session: DbSession,
    _user: CurrentUser,
    camera_id: str | None = Query(default=None, alias="cameraId"),
    date_from: datetime | None = Query(default=None, alias="dateFrom"),
    date_to: datetime | None = Query(default=None, alias="dateTo"),
    has_incident: bool | None = Query(default=None, alias="hasIncident"),
    recording_status: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
) -> list[Recording]:
    recordings = await _list_archive_recordings(
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
    _user: CurrentUser,
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
async def get_recording_segment_media(
    segment_id: str,
    _user: CurrentUser,
) -> FileResponse:
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


@router.get("/{recording_id}/media")
async def get_recording_media(
    recording_id: str,
    session: DbSession,
    _user: CurrentUser,
) -> FileResponse:
    model = await get_recording_model(session, recording_id, ready_only=True)
    file_path = resolve_archive_file(model.file_path if model else None)
    if model is None or file_path is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Arsip rekaman tidak ditemukan atau masa simpannya telah berakhir",
        )

    return FileResponse(
        path=file_path,
        media_type="video/mp4",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/clips/{clip_id}/media")
async def get_evidence_clip_media(
    clip_id: str,
    session: DbSession,
    _user: CurrentUser,
) -> FileResponse:
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
async def get_recording_by_id(
    recording_id: str,
    session: DbSession,
    _user: CurrentUser,
) -> Recording:
    model = await get_recording_model(session, recording_id, ready_only=True)
    if model is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rekaman tidak ditemukan",
        )
    logs = await list_bullying_logs(
        session,
        camera_id=model.camera_id,
        date_from=model.start_time,
        date_to=model.end_time,
    )
    return to_recording_schema(
        model,
        incident_count=len(logs),
        file_available=resolve_archive_file(model.file_path) is not None,
    )


@router.get("/{recording_id}/clips", response_model=list[EvidenceClipResponse])
async def get_evidence_clips(
    recording_id: str,
    session: DbSession,
    _user: CurrentUser,
) -> list[EvidenceClipResponse]:
    return await list_evidence_clips(session, recording_id)


@router.post("/{recording_id}/clips", response_model=EvidenceClipResponse)
async def create_evidence_clip(
    recording_id: str,
    request: EvidenceClipRequest,
    session: DbSession,
    _admin: AdminUser,
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

    if not await _recording_source_exists(
        session,
        recording_id=recording_id,
        camera_id=request.camera_id,
        start_time=request.start_time,
        end_time=request.end_time,
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rekaman sumber tidak ditemukan pada rentang waktu tersebut",
        )

    clip = await queue_evidence_clip(session, recording_id, request)
    schedule_evidence_clip(clip.id)
    return clip


async def _list_archive_recordings(
    session: AsyncSession,
    *,
    camera_id: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[Recording]:
    models = await list_ready_recording_models(
        session,
        camera_id=camera_id,
        date_from=date_from,
        date_to=date_to,
    )
    logs = await list_bullying_logs(
        session,
        camera_id=camera_id,
        date_from=date_from,
        date_to=date_to,
    )
    return [
        to_recording_schema(
            model,
            incident_count=sum(
                1
                for log in logs
                if log.camera_id == model.camera_id
                and log.timestamp >= model.start_time
                and log.timestamp <= model.end_time
            ),
            file_available=resolve_archive_file(model.file_path) is not None,
        )
        for model in models
    ]


async def _recording_source_exists(
    session: AsyncSession,
    *,
    recording_id: str,
    camera_id: str,
    start_time: datetime,
    end_time: datetime,
) -> bool:
    archive = await get_recording_model(session, recording_id, ready_only=True)
    if archive is not None:
        return (
            archive.camera_id == camera_id
            and start_time >= archive.start_time
            and end_time <= archive.end_time
            and resolve_archive_file(archive.file_path) is not None
        )

    cameras = [to_camera_schema(camera) for camera in await list_cameras(session)]
    segments = list_recording_segments(
        camera_id=camera_id,
        date_from=start_time,
        date_to=end_time,
        cameras=cameras,
    )
    return any(segment.media_url for segment in segments)


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
