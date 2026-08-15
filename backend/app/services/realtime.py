import logging
from dataclasses import dataclass

from fastapi import WebSocket

from app.schemas import Alert, UserRole

logger = logging.getLogger("brave-ai.alerts")


@dataclass(frozen=True)
class AlertConnection:
    websocket: WebSocket
    user_id: str
    role: UserRole


class AlertConnectionManager:
    def __init__(self) -> None:
        self.active_connections: dict[WebSocket, AlertConnection] = {}

    async def connect(
        self,
        websocket: WebSocket,
        *,
        user_id: str,
        role: UserRole,
    ) -> None:
        await websocket.accept()
        self.active_connections[websocket] = AlertConnection(
            websocket=websocket,
            user_id=user_id,
            role=role,
        )

    def disconnect(self, websocket: WebSocket) -> None:
        self.active_connections.pop(websocket, None)

    async def broadcast_alert(
        self,
        alert: Alert,
        *,
        audience: str = "all",
    ) -> None:
        stale_connections: list[WebSocket] = []
        payload = alert.model_dump(mode="json", by_alias=True)

        for connection in list(self.active_connections.values()):
            if audience != "all" and connection.role != audience:
                continue
            try:
                await connection.websocket.send_json(payload)
            except Exception:
                logger.warning(
                    "Koneksi alert user %s terputus saat broadcast; koneksi dibersihkan.",
                    connection.user_id,
                    exc_info=True,
                )
                stale_connections.append(connection.websocket)

        for connection in stale_connections:
            self.disconnect(connection)


alert_manager = AlertConnectionManager()
