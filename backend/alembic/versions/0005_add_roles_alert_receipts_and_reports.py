"""add role authorization, alert receipts, and incident reports

Revision ID: 0005_roles_reports
Revises: 0004_add_incident_verification
Create Date: 2026-08-01 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0005_roles_reports"
down_revision: str | None = "0004_add_incident_verification"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("UPDATE users SET role = 'admin' WHERE role = 'operator'")

    op.add_column(
        "bullying_logs",
        sa.Column(
            "camera_location",
            sa.String(length=255),
            nullable=False,
            server_default=sa.text("'-'"),
        ),
    )
    op.execute(
        """
        UPDATE bullying_logs AS logs
        SET camera_location = cameras.location
        FROM cameras
        WHERE cameras.id = logs.camera_id
        """
    )
    op.add_column(
        "bullying_logs",
        sa.Column("report_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "bullying_logs",
        sa.Column("verified_by_user_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "bullying_logs",
        sa.Column("verified_by_name", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "bullying_logs",
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_bullying_logs_report_id",
        "bullying_logs",
        ["report_id"],
        unique=True,
    )
    op.alter_column("bullying_logs", "camera_location", server_default=None)

    op.add_column(
        "alerts",
        sa.Column(
            "audience",
            sa.String(length=24),
            nullable=False,
            server_default=sa.text("'all'"),
        ),
    )
    op.execute(
        """
        UPDATE alerts
        SET audience = CASE
            WHEN type = 'bullying_detected' THEN 'viewer'
            WHEN type IN ('camera_offline', 'camera_online', 'system') THEN 'admin'
            ELSE 'all'
        END
        """
    )
    op.create_index("ix_alerts_audience", "alerts", ["audience"])
    op.alter_column("alerts", "audience", server_default=None)

    op.create_table(
        "alert_read_receipts",
        sa.Column("alert_id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["alert_id"], ["alerts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("alert_id", "user_id"),
    )
    op.create_index(
        "ix_alert_read_receipts_user_id",
        "alert_read_receipts",
        ["user_id"],
    )

    op.create_table(
        "incident_reports",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("log_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("chronology", sa.Text(), nullable=False),
        sa.Column("handling_notes", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=64), nullable=False),
        sa.Column("created_by_name", sa.String(length=120), nullable=False),
        sa.Column("updated_by_user_id", sa.String(length=64), nullable=False),
        sa.Column("updated_by_name", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["log_id"],
            ["bullying_logs.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("log_id", name="uq_incident_reports_log_id"),
    )
    op.create_index(
        "ix_incident_reports_log_id",
        "incident_reports",
        ["log_id"],
        unique=True,
    )
    op.create_index(
        "ix_incident_reports_status",
        "incident_reports",
        ["status"],
    )
    op.execute(
        """
        INSERT INTO incident_reports (
            id,
            log_id,
            title,
            chronology,
            handling_notes,
            status,
            created_by_user_id,
            created_by_name,
            updated_by_user_id,
            updated_by_name,
            created_at,
            updated_at
        )
        SELECT
            'report-' || substr(md5(id), 1, 12),
            id,
            replace(title, 'Indikasi', 'Laporan'),
            '',
            '',
            CASE WHEN status = 'selesai' THEN 'selesai' ELSE 'draft' END,
            'system-migration',
            'Sistem',
            'system-migration',
            'Sistem',
            created_at,
            updated_at
        FROM bullying_logs
        WHERE verification_status = 'bullying'
        """
    )
    op.execute(
        """
        UPDATE bullying_logs AS logs
        SET
            report_id = reports.id,
            verified_by_name = COALESCE(logs.verified_by_name, 'Sistem'),
            verified_at = COALESCE(logs.verified_at, logs.updated_at)
        FROM incident_reports AS reports
        WHERE reports.log_id = logs.id
        """
    )


def downgrade() -> None:
    op.drop_index("ix_incident_reports_status", table_name="incident_reports")
    op.drop_index("ix_incident_reports_log_id", table_name="incident_reports")
    op.drop_table("incident_reports")

    op.drop_index(
        "ix_alert_read_receipts_user_id",
        table_name="alert_read_receipts",
    )
    op.drop_table("alert_read_receipts")

    op.drop_index("ix_alerts_audience", table_name="alerts")
    op.drop_column("alerts", "audience")

    op.drop_index("ix_bullying_logs_report_id", table_name="bullying_logs")
    op.drop_column("bullying_logs", "verified_at")
    op.drop_column("bullying_logs", "verified_by_name")
    op.drop_column("bullying_logs", "verified_by_user_id")
    op.drop_column("bullying_logs", "report_id")
    op.drop_column("bullying_logs", "camera_location")
