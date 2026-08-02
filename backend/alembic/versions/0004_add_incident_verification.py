"""add incident verification status

Revision ID: 0004_add_incident_verification
Revises: 0003_create_reporting_tables
Create Date: 2026-07-19 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0004_add_incident_verification"
down_revision: str | None = "0003_create_reporting_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "bullying_logs",
        sa.Column(
            "verification_status",
            sa.String(length=24),
            nullable=False,
            server_default=sa.text("'pending'"),
        ),
    )
    op.create_index(
        "ix_bullying_logs_verification_status",
        "bullying_logs",
        ["verification_status"],
    )
    op.alter_column("bullying_logs", "verification_status", server_default=None)


def downgrade() -> None:
    op.drop_index(
        "ix_bullying_logs_verification_status",
        table_name="bullying_logs",
    )
    op.drop_column("bullying_logs", "verification_status")
