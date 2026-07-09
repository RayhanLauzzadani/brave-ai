"""create cameras table

Revision ID: 0002_create_cameras
Revises: 0001_create_users
Create Date: 2026-07-09 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0002_create_cameras"
down_revision: str | None = "0001_create_users"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cameras",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("location", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("stream_url", sa.String(length=1000), nullable=True),
        sa.Column("media_path", sa.String(length=255), nullable=True),
        sa.Column("live_hls_url", sa.String(length=1000), nullable=True),
        sa.Column("source_type", sa.String(length=32), nullable=False),
        sa.Column("thumbnail_url", sa.String(length=1000), nullable=True),
        sa.Column("last_active", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_ai_enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_cameras_media_path", "cameras", ["media_path"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_cameras_media_path", table_name="cameras")
    op.drop_table("cameras")