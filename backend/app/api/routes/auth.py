from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser
from app.core.config import get_settings
from app.core.security import create_session_token, verify_password
from app.db.session import get_db_session
from app.repositories.users import get_user_by_email, to_user_schema
from app.schemas import AuthResponse, LoginCredentials, User

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db_session)]
settings = get_settings()


@router.post("/login", response_model=AuthResponse)
async def login(
    credentials: LoginCredentials,
    response: Response,
    session: DbSession,
) -> AuthResponse:
    user = await get_user_by_email(session, credentials.email)
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email atau password salah",
        )

    token = create_session_token(
        user.id,
        settings.secret_key,
        settings.access_token_expire_minutes,
    )
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )
    return AuthResponse(user=to_user_schema(user))


@router.get("/me", response_model=User)
async def me(user: CurrentUser) -> User:
    return to_user_schema(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response) -> None:
    response.delete_cookie(
        key=settings.session_cookie_name,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )
    return None
