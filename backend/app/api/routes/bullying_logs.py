from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.repositories.reporting import (
    get_bullying_log,
    list_bullying_logs,
    update_bullying_log_status,
)
from app.schemas import BullyingLog, BullyingLogStatusUpdate

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("", response_model=list[BullyingLog])
async def get_logs(
    session: DbSession,
    camera_id: str | None = Query(default=None, alias="cameraId"),
    severity: str | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    bully_type: str | None = Query(default=None, alias="bullyType"),
    recording_id: str | None = Query(default=None, alias="recordingId"),
    date_from: datetime | None = Query(default=None, alias="dateFrom"),
    date_to: datetime | None = Query(default=None, alias="dateTo"),
    search: str | None = Query(default=None),
) -> list[BullyingLog]:
    return await list_bullying_logs(
        session,
        camera_id=camera_id,
        severity=severity,
        status=status_filter,
        bully_type=bully_type,
        recording_id=recording_id,
        date_from=date_from,
        date_to=date_to,
        search=search,
    )


@router.get("/{log_id}", response_model=BullyingLog)
async def get_log_by_id(log_id: str, session: DbSession) -> BullyingLog:
    log = await get_bullying_log(session, log_id)
    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Log bullying tidak ditemukan",
        )
    return log


@router.patch("/{log_id}/status", response_model=BullyingLog)
async def update_status(
    log_id: str,
    payload: BullyingLogStatusUpdate,
    session: DbSession,
) -> BullyingLog:
    log = await update_bullying_log_status(session, log_id, payload.status)
    if not log:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Log bullying tidak ditemukan",
        )
    return log