from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, status

from app.data.mock_data import get_recording, list_recordings, queue_evidence_clip
from app.schemas import EvidenceClipRequest, EvidenceClipResponse, Recording

router = APIRouter()


@router.get("", response_model=list[Recording])
async def get_recordings(
    camera_id: str | None = Query(default=None, alias="cameraId"),
    date_from: datetime | None = Query(default=None, alias="dateFrom"),
    date_to: datetime | None = Query(default=None, alias="dateTo"),
    has_incident: bool | None = Query(default=None, alias="hasIncident"),
    recording_status: str | None = Query(default=None, alias="status"),
    search: str | None = Query(default=None),
) -> list[Recording]:
    return list_recordings(
        camera_id=camera_id,
        date_from=date_from,
        date_to=date_to,
        has_incident=has_incident,
        recording_status=recording_status,
        search=search,
    )


@router.get("/{recording_id}", response_model=Recording)
async def get_recording_by_id(recording_id: str) -> Recording:
    recording = get_recording(recording_id)
    if not recording:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rekaman tidak ditemukan",
        )
    return recording


@router.post("/{recording_id}/clips", response_model=EvidenceClipResponse)
async def create_evidence_clip(
    recording_id: str,
    request: EvidenceClipRequest,
) -> EvidenceClipResponse:
    recording = get_recording(recording_id)
    if not recording:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Rekaman tidak ditemukan",
        )
    return queue_evidence_clip(recording_id, request)
