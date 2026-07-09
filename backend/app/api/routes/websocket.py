from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.db.session import AsyncSessionLocal
from app.repositories.reporting import list_alerts
from app.services.realtime import alert_manager

router = APIRouter()


@router.websocket("/ws/alerts")
async def alerts_socket(websocket: WebSocket) -> None:
    await alert_manager.connect(websocket)
    try:
        async with AsyncSessionLocal() as session:
            for alert in await list_alerts(session, unread_only=True):
                await websocket.send_json(alert.model_dump(mode="json", by_alias=True))

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        alert_manager.disconnect(websocket)