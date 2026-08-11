import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db_session
from app.repositories.reporting import create_incident_event
from app.schemas import IncidentEventCreate, IncidentEventResult
from app.services.realtime import alert_manager

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db_session)]
settings = get_settings()


@router.post("", response_model=IncidentEventResult, status_code=status.HTTP_201_CREATED)
async def ingest_incident_event(
    payload: IncidentEventCreate,
    session: DbSession,
    x_brave_ingest_token: Annotated[str | None, Header()] = None,
) -> IncidentEventResult:
    expected_token = settings.incident_ingest_token.strip()
    if settings.environment.strip().lower() == "production" and not expected_token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Token ingest event belum dikonfigurasi.",
        )
    if expected_token and not x_brave_ingest_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token ingest event tidak ada.",
        )
    if expected_token and not secrets.compare_digest(
        x_brave_ingest_token or "",
        expected_token,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token ingest event tidak valid.",
        )
    result, created = await create_incident_event(session, payload)
    if created:
        await alert_manager.broadcast_alert(result.alert, audience="all")
    return result
