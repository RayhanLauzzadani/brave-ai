from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.data.mock_data import list_alerts
from app.services.realtime import alert_manager

router = APIRouter()


@router.websocket("/ws/alerts")
async def alerts_socket(websocket: WebSocket) -> None:
    await alert_manager.connect(websocket)
    try:
        for alert in list_alerts(unread_only=True):
            await websocket.send_json(alert.model_dump(mode="json", by_alias=True))

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        alert_manager.disconnect(websocket)
