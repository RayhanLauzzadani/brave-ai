import asyncio

from app.core.config import get_settings
from app.core.security import hash_password, verify_password
from app.db.session import AsyncSessionLocal
from app.repositories.users import create_user, get_user_by_email

settings = get_settings()


async def seed_demo_users() -> None:
    accounts = (
        (
            "Admin Sekolah",
            settings.seed_admin_email,
            settings.seed_admin_password,
            "admin",
        ),
        (
            "Guru BK",
            settings.seed_viewer_email,
            settings.seed_viewer_password,
            "viewer",
        ),
    )
    empty_password_accounts = [email for _, email, password, _ in accounts if not password]
    if empty_password_accounts:
        emails = ", ".join(empty_password_accounts)
        raise RuntimeError(f"Seed password cannot be empty for: {emails}")

    async with AsyncSessionLocal() as session:
        for name, email, password, role in accounts:
            existing = await get_user_by_email(session, email)
            if existing:
                changed = False
                if existing.role != role:
                    existing.role = role
                    changed = True
                if existing.name != name:
                    existing.name = name
                    changed = True
                if not verify_password(password, existing.password_hash):
                    existing.password_hash = hash_password(password)
                    changed = True
                if changed:
                    await session.commit()
                print(f"Demo user already exists: {email}")
                continue

            await create_user(
                session,
                name=name,
                email=email,
                password_hash=hash_password(password),
                role=role,
                avatar=None,
            )
            print(f"Created demo user: {email}")


if __name__ == "__main__":
    asyncio.run(seed_demo_users())
