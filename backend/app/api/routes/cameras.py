from fastapi import APIRouter, HTTPException, status

from app.data.mock_data import get_camera, list_cameras, update_camera_source
from app.schemas import Camera, CameraSourceUpdate

router = APIRouter()


@router.get("", response_model=list[Camera])
async def get_cameras() -> list[Camera]:
    return list_cameras()


@router.get("/{camera_id}", response_model=Camera)
async def get_camera_by_id(camera_id: str) -> Camera:
    camera = get_camera(camera_id)
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kamera tidak ditemukan",
        )
    return camera


@router.patch("/{camera_id}/source", response_model=Camera)
async def patch_camera_source(
    camera_id: str,
    payload: CameraSourceUpdate,
) -> Camera:
    camera = update_camera_source(camera_id, payload)
    if not camera:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kamera tidak ditemukan",
        )
    return camera
