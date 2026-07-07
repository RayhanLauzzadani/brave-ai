from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_demo_token, verify_password
from app.db.session import get_db_session
from app.repositories.users import get_first_user, get_user_by_email, to_user_schema
from app.schemas import AuthResponse, LoginCredentials, User

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.post("/login", response_model=AuthResponse)
async def login(credentials: LoginCredentials, session: DbSession) -> AuthResponse:
    user = await get_user_by_email(session, credentials.email)
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email atau password salah",
        )

    return AuthResponse(user=to_user_schema(user), token=create_demo_token())


@router.get("/me", response_model=User)
async def me(session: DbSession) -> User:
    user = await get_user_by_email(session, "admin@braveai.school")
    if not user:
        user = await get_first_user(session)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User demo belum tersedia",
        )
    return to_user_schema(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout() -> None:
    return None