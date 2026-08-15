import asyncio
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.dependencies import get_current_user, require_roles
from app.api.routes.cameras import router as cameras_router
from app.api.routes.recordings import router as recordings_router
from app.db.session import get_db_session
from app.models.user import UserModel
from app.schemas import Alert
from app.services.realtime import AlertConnectionManager


def make_user(role: str) -> UserModel:
    now = datetime.now(UTC)
    return UserModel(
        id=f"user-{role}",
        name="User Test",
        email=f"{role}@example.test",
        password_hash="unused",
        role=role,
        avatar=None,
        created_at=now,
        updated_at=now,
    )


def test_admin_permission_rejects_viewer() -> None:
    dependency = require_roles("admin")

    with pytest.raises(HTTPException) as caught:
        asyncio.run(dependency(make_user("viewer")))

    assert caught.value.status_code == 403


def test_admin_permission_accepts_admin() -> None:
    dependency = require_roles("admin")
    user = make_user("admin")

    assert asyncio.run(dependency(user)) is user


def test_viewer_cannot_mutate_camera_or_create_clip() -> None:
    app = FastAPI()
    app.include_router(cameras_router, prefix="/api/cameras")
    app.include_router(recordings_router, prefix="/api/recordings")

    async def current_viewer() -> UserModel:
        return make_user("viewer")

    async def fake_session():
        yield object()

    app.dependency_overrides[get_current_user] = current_viewer
    app.dependency_overrides[get_db_session] = fake_session

    requests = [
        ("POST", "/api/cameras", {"name": "Kamera", "location": "Koridor"}),
        (
            "PATCH",
            "/api/cameras/camera-test",
            {"name": "Nama Baru", "location": "Kantin"},
        ),
        (
            "PATCH",
            "/api/cameras/camera-test/source",
            {"sourceType": "hls", "mediaPath": "camera-test"},
        ),
        ("DELETE", "/api/cameras/camera-test", None),
        (
            "POST",
            "/api/recordings/recording-test/clips",
            {
                "cameraId": "camera-test",
                "startTime": "2026-08-01T10:00:00Z",
                "endTime": "2026-08-01T10:00:30Z",
                "reason": "manual_save",
            },
        ),
    ]

    with TestClient(app) as client:
        for method, path, payload in requests:
            response = client.request(method, path, json=payload)
            assert response.status_code == 403, path


def test_realtime_incident_alert_is_sent_to_admin_and_viewer() -> None:
    manager = AlertConnectionManager()
    viewer_socket = FakeWebSocket()
    admin_socket = FakeWebSocket()

    async def scenario() -> None:
        await manager.connect(
            viewer_socket,
            user_id="viewer-1",
            role="viewer",
        )
        await manager.connect(
            admin_socket,
            user_id="admin-1",
            role="admin",
        )
        await manager.broadcast_alert(make_alert(), audience="all")

    asyncio.run(scenario())

    assert viewer_socket.accepted is True
    assert len(viewer_socket.messages) == 1
    assert viewer_socket.messages[0]["id"] == "alert-test"
    assert len(admin_socket.messages) == 1
    assert admin_socket.messages[0]["id"] == "alert-test"


def test_broken_realtime_connection_does_not_block_other_users() -> None:
    manager = AlertConnectionManager()
    broken_socket = FakeWebSocket(fail_on_send=True)
    healthy_socket = FakeWebSocket()

    async def scenario() -> None:
        await manager.connect(
            broken_socket,
            user_id="viewer-broken",
            role="viewer",
        )
        await manager.connect(
            healthy_socket,
            user_id="viewer-healthy",
            role="viewer",
        )
        await manager.broadcast_alert(make_alert(), audience="all")

    asyncio.run(scenario())

    assert len(healthy_socket.messages) == 1
    assert broken_socket not in manager.active_connections
    assert healthy_socket in manager.active_connections


def make_alert() -> Alert:
    return Alert(
        id="alert-test",
        type="bullying_detected",
        priority="high",
        cameraId="camera-1",
        cameraName="Kamera 1",
        title="Indikasi baru",
        message="Perlu diperiksa",
        timestamp=datetime.now(UTC),
        isRead=False,
        metadata={"logId": "log-test"},
    )


class FakeWebSocket:
    def __init__(self, *, fail_on_send: bool = False) -> None:
        self.accepted = False
        self.fail_on_send = fail_on_send
        self.messages: list[dict[str, Any]] = []

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, payload: dict[str, Any]) -> None:
        if self.fail_on_send:
            raise OSError("socket closed")
        self.messages.append(payload)
