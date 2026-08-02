from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import CurrentUser
from app.db.session import get_db_session
from app.repositories.reporting import (
    get_incident_report,
    list_incident_reports,
    update_incident_report,
)
from app.schemas import IncidentReport, IncidentReportUpdate, ReportStatus

router = APIRouter()
DbSession = Annotated[AsyncSession, Depends(get_db_session)]


@router.get("", response_model=list[IncidentReport])
async def get_reports(
    session: DbSession,
    _user: CurrentUser,
    report_status: ReportStatus | None = Query(default=None, alias="status"),
) -> list[IncidentReport]:
    return await list_incident_reports(session, status=report_status)


@router.get("/{report_id}", response_model=IncidentReport)
async def get_report(
    report_id: str,
    session: DbSession,
    _user: CurrentUser,
) -> IncidentReport:
    report = await get_incident_report(session, report_id)
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Laporan tidak ditemukan",
        )
    return report


@router.patch("/{report_id}", response_model=IncidentReport)
async def patch_report(
    report_id: str,
    payload: IncidentReportUpdate,
    session: DbSession,
    user: CurrentUser,
) -> IncidentReport:
    if not payload.model_fields_set:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tidak ada perubahan laporan yang dikirim",
        )
    report = await update_incident_report(session, report_id, payload, user)
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Laporan tidak ditemukan",
        )
    return report
