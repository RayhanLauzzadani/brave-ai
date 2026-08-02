from typing import cast

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import get_settings
from app.core.security import SessionTokenError, decode_session_token
from app.db.session import AsyncSessionLocal
from app.repositories.users import get_user_by_id
from app.schemas import UserRole
from app.services.realtime import alert_manager

router = APIRouter()
settings = get_settings()


@router.websocket("/ws/alerts")
async def alerts_socket(websocket: WebSocket) -> None:
    token = websocket.cookies.get(settings.session_cookie_name)
    if not token:
        await websocket.close(code=4401, reason="Sesi login tidak tersedia")
        return

    try:
        payload = decode_session_token(token, settings.secret_key)
    except SessionTokenError:
        await websocket.close(code=4401, reason="Sesi login tidak valid")
        return

    async with AsyncSessionLocal() as session:
        user = await get_user_by_id(session, payload["sub"])
    if not user or user.role not in {"admin", "viewer"}:
        await websocket.close(code=4401, reason="User tidak tersedia")
        return

    await alert_manager.connect(
        websocket,
        user_id=user.id,
        role=cast(UserRole, user.role),
    )
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        alert_manager.disconnect(websocket)
