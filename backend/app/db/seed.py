import asyncio

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.repositories.users import create_user, get_user_by_email

settings = get_settings()


async def seed_demo_users() -> None:
    async with AsyncSessionLocal() as session:
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
