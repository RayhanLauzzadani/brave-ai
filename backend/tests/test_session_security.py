from datetime import UTC, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.auth import router as auth_router
from app.core.security import (
    SessionTokenError,
    create_session_token,
    decode_session_token,
)
from app.schemas import IncidentReportUpdate


def test_session_token_round_trip() -> None:
    now = datetime(2026, 8, 1, 10, 0, tzinfo=UTC)
    token = create_session_token("user-viewer", "test-secret", 30, now=now)

    payload = decode_session_token(
        token,
        "test-secret",
        now=now + timedelta(minutes=5),
    )

    assert payload["sub"] == "user-viewer"
    assert payload["exp"] > payload["iat"]


def test_session_token_rejects_tampering_and_expiry() -> None:
    now = datetime(2026, 8, 1, 10, 0, tzinfo=UTC)
    token = create_session_token("user-admin", "test-secret", 1, now=now)
    header, payload, signature = token.split(".")
    first = "A" if signature[0] != "A" else "B"
    tampered = f"{header}.{payload}.{first}{signature[1:]}"

    with pytest.raises(SessionTokenError, match="Signature"):
        decode_session_token(tampered, "test-secret", now=now)

    with pytest.raises(SessionTokenError, match="kedaluwarsa"):
        decode_session_token(
            token,
            "test-secret",
            now=now + timedelta(minutes=2),
        )


def test_report_title_is_trimmed_and_cannot_be_blank() -> None:
    payload = IncidentReportUpdate(title="  Laporan kejadian  ")
    assert payload.title == "Laporan kejadian"

    with pytest.raises(ValueError, match="Judul laporan"):
        IncidentReportUpdate(title="   ")


def test_logout_expires_session_cookie() -> None:
    app = FastAPI()
    app.include_router(auth_router, prefix="/api/auth")

    with TestClient(app) as client:
        client.cookies.set("brave_session", "session-test")
        response = client.post("/api/auth/logout")

    cookie_header = response.headers["set-cookie"]
    assert response.status_code == 204
    assert 'brave_session=""' in cookie_header
    assert "Max-Age=0" in cookie_header
    assert "HttpOnly" in cookie_header
