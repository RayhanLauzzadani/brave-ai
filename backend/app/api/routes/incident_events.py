from fastapi import APIRouter, status

from app.data.mock_data import create_incident_event
from app.schemas import IncidentEventCreate, IncidentEventResult
from app.services.realtime import alert_manager

router = APIRouter()


@router.post("", response_model=IncidentEventResult, status_code=status.HTTP_201_CREATED)
async def ingest_incident_event(payload: IncidentEventCreate) -> IncidentEventResult:
    result = create_incident_event(payload)
    await alert_manager.broadcast_alert(result.alert)
    return result
