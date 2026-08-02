"""create persistent 24-hour recording archives

Revision ID: 0006_recording_archives
Revises: 0005_roles_reports
Create Date: 2026-08-01 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0006_recording_archives"
down_revision: str | None = "0005_roles_reports"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "recordings",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("camera_id", sa.String(length=64), nullable=False),
        sa.Column("media_path", sa.String(length=255), nullable=False),
        sa.Column("camera_name", sa.String(length=120), nullable=False),
        sa.Column("location", sa.String(length=255), nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("file_path", sa.String(length=1000), nullable=True),
        sa.Column(
            "file_size",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("source_segment_count", sa.Integer(), nullable=False),
        sa.Column(
            "archive_status",
            sa.String(length=24),
            nullable=False,
            server_default=sa.text("'processing'"),
        ),
        sa.Column(
            "recording_status",
            sa.String(length=24),
            nullable=False,
            server_default=sa.text("'tersimpan'"),
        ),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("available_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint(
            "camera_id",
            "start_time",
            name="uq_recordings_camera_start_time",
        ),
    )
    op.create_index("ix_recordings_camera_id", "recordings", ["camera_id"])
    op.create_index("ix_recordings_media_path", "recordings", ["media_path"])
    op.create_index("ix_recordings_start_time", "recordings", ["start_time"])
    op.create_index("ix_recordings_end_time", "recordings", ["end_time"])
    op.create_index(
        "ix_recordings_archive_status", "recordings", ["archive_status"]
    )
    op.create_index(
        "ix_recordings_recording_status", "recordings", ["recording_status"]
    )
    op.create_index("ix_recordings_expires_at", "recordings", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_recordings_expires_at", table_name="recordings")
    op.drop_index("ix_recordings_recording_status", table_name="recordings")
    op.drop_index("ix_recordings_archive_status", table_name="recordings")
    op.drop_index("ix_recordings_end_time", table_name="recordings")
    op.drop_index("ix_recordings_start_time", table_name="recordings")
    op.drop_index("ix_recordings_media_path", table_name="recordings")
    op.drop_index("ix_recordings_camera_id", table_name="recordings")
    op.drop_table("recordings")
