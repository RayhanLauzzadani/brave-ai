from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import SessionTokenError, decode_session_token
from app.db.session import get_db_session
from app.models.user import UserModel
from app.repositories.users import get_user_by_id
from app.schemas import UserRole

settings = get_settings()
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


async def get_current_user(request: Request, session: DbSession) -> UserModel:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise _unauthorized()

    try:
        payload = decode_session_token(token, settings.secret_key)
    except SessionTokenError as exc:
        raise _unauthorized() from exc

    user = await get_user_by_id(session, payload['sub'])
    if not user or user.role not in {'admin', 'viewer'}:
        raise _unauthorized()
    return user


CurrentUser = Annotated[UserModel, Depends(get_current_user)]


def require_roles(
    *allowed_roles: UserRole,
) -> Callable[..., Awaitable[UserModel]]:
    async def dependency(user: CurrentUser) -> UserModel:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail='Anda tidak memiliki izin untuk melakukan tindakan ini',
            )
        return user

    return dependency


AdminUser = Annotated[UserModel, Depends(require_roles('admin'))]


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail='Sesi login tidak valid atau sudah berakhir',
        headers={'WWW-Authenticate': 'Bearer'},
    )
