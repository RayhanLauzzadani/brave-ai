from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.repositories.cameras import (
    create_camera,
    delete_camera,
    get_camera,
    list_cameras,
    to_camera_schema,
    update_camera_source,
)
from app.schemas import Camera, CameraCreate, CameraSourceUpdate

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.post("", response_model=Camera, status_code=status.HTTP_201_CREATED)
async def create_camera_route(payload: CameraCreate, session: DbSession) -> Camera:
    camera = await create_camera(session, payload)
    return to_camera_schema(camera)


@router.get("", response_model=list[Camera])
async def get_cameras(session: DbSession) -> list[Camera]:
    cameras = await list_cameras(session)
    return [to_camera_schema(camera) for camera in cameras]


@router.get("/{camera_id}", response_model=Camera)
async def get_camera_route(camera_id: str, session: DbSession) -> Camera:
    camera = await get_camera(session, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    return to_camera_schema(camera)


@router.delete("/{camera_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_camera(camera_id: str, session: DbSession) -> None:
    success = await delete_camera(session, camera_id)
    if not success:
        raise HTTPException(status_code=404, detail="Camera not found")


@router.patch("/{camera_id}/source", response_model=Camera)
async def patch_camera_source(
    camera_id: str,
    payload: CameraSourceUpdate,
    session: DbSession,
) -> Camera:
    camera = await update_camera_source(session, camera_id, payload)
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kamera tidak ditemukan",
        )
    return to_camera_schema(camera)