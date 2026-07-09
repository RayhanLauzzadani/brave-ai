from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.repositories.reporting import create_incident_event
from app.schemas import IncidentEventCreate, IncidentEventResult
from app.services.realtime import alert_manager

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.post("", response_model=IncidentEventResult, status_code=status.HTTP_201_CREATED)
async def ingest_incident_event(
    payload: IncidentEventCreate,
    session: DbSession,
) -> IncidentEventResult:
    result = await create_incident_event(session, payload)
    await alert_manager.broadcast_alert(result.alert)
    return result