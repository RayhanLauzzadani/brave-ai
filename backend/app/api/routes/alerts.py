from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.repositories.reporting import list_alerts, mark_alert_read, mark_all_alerts_read
from app.schemas import Alert, MarkReadRequest

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("", response_model=list[Alert])
async def get_alerts(
    session: DbSession,
    unread_only: bool = Query(default=False, alias="unreadOnly"),
) -> list[Alert]:
    return await list_alerts(session, unread_only=unread_only)


@router.post("/mark-read", response_model=Alert)
async def mark_read(request: MarkReadRequest, session: DbSession) -> Alert:
    alert = await mark_alert_read(session, request.alert_id)
    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert tidak ditemukan",
        )
    return alert


@router.post("/mark-all-read", response_model=list[Alert])
async def mark_all_read(session: DbSession) -> list[Alert]:
    return await mark_all_alerts_read(session)