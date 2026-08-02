from datetime import UTC, datetime

from sqlalchemy import BigInteger, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class RecordingModel(Base):
    __tablename__ = "recordings"
    __table_args__ = (
        UniqueConstraint(
            "camera_id",
            "start_time",
            name="uq_recordings_camera_start_time",
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    camera_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    media_path: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    camera_name: Mapped[str] = mapped_column(String(120), nullable=False)
    location: Mapped[str] = mapped_column(String(255), nullable=False)
    start_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    end_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    file_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    source_segment_count: Mapped[int] = mapped_column(Integer, nullable=False)
    archive_status: Mapped[str] = mapped_column(
        String(24), index=True, nullable=False, default="processing"
    )
    recording_status: Mapped[str] = mapped_column(
        String(24), index=True, nullable=False, default="tersimpan"
    )
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    available_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
