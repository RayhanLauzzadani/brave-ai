import asyncio

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.repositories.users import create_user, get_user_by_email

DEMO_EMAIL = "admin@braveai.school"
DEMO_PASSWORD = "password"


async def seed_demo_user() -> None:
    async with AsyncSessionLocal() as session:
        existing = await get_user_by_email(session, DEMO_EMAIL)
        if existing:
            print(f"Demo user already exists: {DEMO_EMAIL}")
            return

        await create_user(
            session,
            name="Admin Sekolah",
            email=DEMO_EMAIL,
            password_hash=hash_password(DEMO_PASSWORD),
            role="admin",
            avatar=None,
        )
        print(f"Created demo user: {DEMO_EMAIL}")


if __name__ == "__main__":
    asyncio.run(seed_demo_user())