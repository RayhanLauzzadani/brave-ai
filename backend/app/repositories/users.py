from typing import cast
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import UserModel
from app.schemas import User, UserRole


def normalize_email(email: str) -> str:
    return email.strip().lower()


def to_user_schema(user: UserModel) -> User:
    return User(
        id=user.id,
        name=user.name,
        email=user.email,
        role=cast(UserRole, user.role),
        avatar=user.avatar,
    )


async def get_user_by_email(session: AsyncSession, email: str) -> UserModel | None:
    result = await session.execute(
        select(UserModel).where(UserModel.email == normalize_email(email))
    )
    return result.scalar_one_or_none()


async def get_first_user(session: AsyncSession) -> UserModel | None:
    result = await session.execute(select(UserModel).order_by(UserModel.created_at))
    return result.scalars().first()


async def create_user(
    session: AsyncSession,
    *,
    name: str,
    email: str,
    password_hash: str,
    role: str,
    avatar: str | None = None,
) -> UserModel:
    user = UserModel(
        id=f"user-{uuid4().hex[:12]}",
        name=name,
        email=normalize_email(email),
        password_hash=password_hash,
        role=role,
        avatar=avatar,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user