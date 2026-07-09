"""create reporting tables

Revision ID: 0003_create_reporting_tables
Revises: 0002_create_cameras
Create Date: 2026-07-09 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0003_create_reporting_tables"
down_revision: str | None = "0002_create_cameras"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "bullying_logs",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("camera_id", sa.String(length=64), nullable=False),
        sa.Column("camera_name", sa.String(length=120), nullable=False),
        sa.Column("recording_id", sa.String(length=255), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("severity", sa.String(length=32), nullable=False),
        sa.Column("bully_type", sa.String(length=32), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("thumbnail_url", sa.String(length=1000), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("pelapor", sa.String(length=120), nullable=False),
        sa.Column("terkait_rekaman", sa.String(length=500), nullable=False),
        sa.Column("timeline", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bullying_logs_camera_id", "bullying_logs", ["camera_id"])
    op.create_index("ix_bullying_logs_recording_id", "bullying_logs", ["recording_id"])
    op.create_index("ix_bullying_logs_timestamp", "bullying_logs", ["timestamp"])
    op.create_index("ix_bullying_logs_severity", "bullying_logs", ["severity"])
    op.create_index("ix_bullying_logs_bully_type", "bullying_logs", ["bully_type"])
    op.create_index("ix_bullying_logs_status", "bullying_logs", ["status"])

    op.create_table(
        "alerts",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False),
        sa.Column("priority", sa.String(length=32), nullable=False),
        sa.Column("camera_id", sa.String(length=64), nullable=True),
        sa.Column("camera_name", sa.String(length=120), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_alerts_priority", "alerts", ["priority"])
    op.create_index("ix_alerts_camera_id", "alerts", ["camera_id"])
    op.create_index("ix_alerts_timestamp", "alerts", ["timestamp"])
    op.create_index("ix_alerts_is_read", "alerts", ["is_read"])

    op.create_table(
        "evidence_clips",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("recording_id", sa.String(length=255), nullable=False),
        sa.Column("camera_id", sa.String(length=64), nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.String(length=120), nullable=False),
        sa.Column("clip_url", sa.String(length=1000), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_evidence_clips_recording_id", "evidence_clips", ["recording_id"])
    op.create_index("ix_evidence_clips_camera_id", "evidence_clips", ["camera_id"])
    op.create_index("ix_evidence_clips_status", "evidence_clips", ["status"])
    op.create_index("ix_evidence_clips_created_at", "evidence_clips", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_evidence_clips_created_at", table_name="evidence_clips")
    op.drop_index("ix_evidence_clips_status", table_name="evidence_clips")
    op.drop_index("ix_evidence_clips_camera_id", table_name="evidence_clips")
    op.drop_index("ix_evidence_clips_recording_id", table_name="evidence_clips")
    op.drop_table("evidence_clips")

    op.drop_index("ix_alerts_is_read", table_name="alerts")
    op.drop_index("ix_alerts_timestamp", table_name="alerts")
    op.drop_index("ix_alerts_camera_id", table_name="alerts")
    op.drop_index("ix_alerts_priority", table_name="alerts")
    op.drop_table("alerts")

    op.drop_index("ix_bullying_logs_status", table_name="bullying_logs")
    op.drop_index("ix_bullying_logs_bully_type", table_name="bullying_logs")
    op.drop_index("ix_bullying_logs_severity", table_name="bullying_logs")
    op.drop_index("ix_bullying_logs_timestamp", table_name="bullying_logs")
    op.drop_index("ix_bullying_logs_recording_id", table_name="bullying_logs")
    op.drop_index("ix_bullying_logs_camera_id", table_name="bullying_logs")
    op.drop_table("bullying_logs")