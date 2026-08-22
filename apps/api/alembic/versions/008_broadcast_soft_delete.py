"""Soft-delete for nearby broadcasts (author-only retract)."""

from alembic import op
import sqlalchemy as sa

revision = "008_broadcast_soft_delete"
down_revision = "007_nearby_broadcasts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("nearby_broadcasts", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    op.create_index("ix_nearby_broadcasts_deleted_at", "nearby_broadcasts", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_nearby_broadcasts_deleted_at", table_name="nearby_broadcasts")
    op.drop_column("nearby_broadcasts", "deleted_at")
