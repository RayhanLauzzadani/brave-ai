from fastapi import APIRouter, HTTPException, Query, status

from app.data.mock_data import list_alerts, mark_alert_read, mark_all_alerts_read
from app.schemas import Alert, MarkReadRequest

router = APIRouter()


@router.get("", response_model=list[Alert])
async def get_alerts(
    unread_only: bool = Query(default=False, alias="unreadOnly"),
) -> list[Alert]:
    return list_alerts(unread_only=unread_only)


@router.post("/mark-read", response_model=Alert)
async def mark_read(request: MarkReadRequest) -> Alert:
    alert = mark_alert_read(request.alert_id)
    if not alert:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert tidak ditemukan",
        )
    return alert


@router.post("/mark-all-read", response_model=list[Alert])
async def mark_all_read() -> list[Alert]:
    return mark_all_alerts_read()
