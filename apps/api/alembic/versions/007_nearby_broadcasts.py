"""Public nearby broadcast feed. Distinct from private conversation messages."""

from alembic import op
import sqlalchemy as sa

revision = "007_nearby_broadcasts"
down_revision = "006_block_anti_abuse"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "nearby_broadcasts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("author_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("display_name", sa.String(length=20), nullable=False),
        sa.Column("body", sa.String(length=280), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("ttl_ms", sa.Integer(), nullable=False),
    )
    op.create_index("ix_nearby_broadcasts_author_id", "nearby_broadcasts", ["author_id"])
    op.create_table(
        "nearby_broadcast_deliveries",
        sa.Column("broadcast_id", sa.String(length=36), sa.ForeignKey("nearby_broadcasts.id"), primary_key=True),
        sa.Column("recipient_id", sa.String(length=36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("nearby_broadcast_deliveries")
    op.drop_index("ix_nearby_broadcasts_author_id", table_name="nearby_broadcasts")
    op.drop_table("nearby_broadcasts")
