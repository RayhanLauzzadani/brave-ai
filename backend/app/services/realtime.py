from fastapi import WebSocket

from app.schemas import Alert


class AlertConnectionManager:
    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast_alert(self, alert: Alert) -> None:
        stale_connections: list[WebSocket] = []
        payload = alert.model_dump(mode="json", by_alias=True)

        for connection in self.active_connections:
            try:
                await connection.send_json(payload)
            except RuntimeError:
                stale_connections.append(connection)

        for connection in stale_connections:
            self.disconnect(connection)


alert_manager = AlertConnectionManager()
