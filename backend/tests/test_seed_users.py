import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from app.core.security import hash_password, verify_password
from app.db import seed as seed_module


class FakeSession:
    def __init__(self) -> None:
        self.commit_count = 0

    async def commit(self) -> None:
        self.commit_count += 1


class FakeSessionContext:
    def __init__(self, session: FakeSession) -> None:
        self.session = session

    async def __aenter__(self) -> FakeSession:
        return self.session

    async def __aexit__(self, *_args: object) -> None:
        return None


def make_settings(*, admin_password: str = "password") -> SimpleNamespace:
    return SimpleNamespace(
        seed_admin_email="admin@braveai.school",
        seed_admin_password=admin_password,
        seed_viewer_email="gurubk@braveai.school",
        seed_viewer_password="password",
    )


def test_seed_updates_existing_demo_accounts(monkeypatch: pytest.MonkeyPatch) -> None:
    users = {
        "admin@braveai.school": SimpleNamespace(
            name="Admin Lama",
            role="operator",
            password_hash=hash_password("old-password"),
        ),
        "gurubk@braveai.school": SimpleNamespace(
            name="Viewer Lama",
            role="viewer",
            password_hash=hash_password("old-password"),
        ),
    }
    session = FakeSession()

    async def get_existing(_session: Any, email: str) -> SimpleNamespace:
        return users[email]

    async def fail_create(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("Existing demo users must not be recreated")

    monkeypatch.setattr(seed_module, "settings", make_settings())
    monkeypatch.setattr(
        seed_module,
        "AsyncSessionLocal",
        lambda: FakeSessionContext(session),
    )
    monkeypatch.setattr(seed_module, "get_user_by_email", get_existing)
    monkeypatch.setattr(seed_module, "create_user", fail_create)

    asyncio.run(seed_module.seed_demo_users())

    assert users["admin@braveai.school"].name == "Admin Sekolah"
    assert users["admin@braveai.school"].role == "admin"
    assert users["gurubk@braveai.school"].name == "Guru BK"
    assert verify_password(
        "password",
        users["admin@braveai.school"].password_hash,
    )
    assert verify_password(
        "password",
        users["gurubk@braveai.school"].password_hash,
    )
    assert session.commit_count == 2


def test_seed_rejects_empty_password_before_opening_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_session_factory() -> None:
        raise AssertionError("Database should not be opened for invalid seed settings")

    monkeypatch.setattr(seed_module, "settings", make_settings(admin_password=""))
    monkeypatch.setattr(seed_module, "AsyncSessionLocal", fail_session_factory)

    with pytest.raises(RuntimeError, match="admin@braveai.school"):
        asyncio.run(seed_module.seed_demo_users())
