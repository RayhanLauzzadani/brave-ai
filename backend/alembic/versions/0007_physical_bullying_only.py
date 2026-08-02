"""restrict bullying incidents to physical events

Revision ID: 0007_physical_only
Revises: 0006_recording_archives
Create Date: 2026-08-02 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0007_physical_only"
down_revision: str | None = "0006_recording_archives"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM alerts AS alerts
        USING bullying_logs AS logs
        WHERE alerts.type = 'bullying_detected'
          AND alerts.metadata->>'logId' = logs.id
          AND logs.bully_type <> 'physical'
        """
    )
    op.execute("DELETE FROM bullying_logs WHERE bully_type <> 'physical'")
    op.create_check_constraint(
        "ck_bullying_logs_physical_type",
        "bullying_logs",
        "bully_type = 'physical'",
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_bullying_logs_physical_type",
        "bullying_logs",
        type_="check",
    )
