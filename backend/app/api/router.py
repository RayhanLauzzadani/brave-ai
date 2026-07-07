from fastapi import APIRouter

from app.api.routes import alerts, auth, bullying_logs, cameras, incident_events, recordings

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(cameras.router, prefix="/cameras", tags=["cameras"])
api_router.include_router(recordings.router, prefix="/recordings", tags=["recordings"])
api_router.include_router(
    bullying_logs.router, prefix="/bullying-logs", tags=["bullying logs"]
)
api_router.include_router(alerts.router, prefix="/alerts", tags=["alerts"])
api_router.include_router(
    incident_events.router, prefix="/incident-events", tags=["incident events"]
)
