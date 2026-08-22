"""Per-user inbox hide/clear. Does not delete messages for other members."""

from alembic import op
import sqlalchemy as sa

revision = "009_conversation_member_hide"
down_revision = "008_broadcast_soft_delete"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("conversation_members", sa.Column("hidden_at", sa.DateTime(), nullable=True))
    op.add_column("conversation_members", sa.Column("cleared_at", sa.DateTime(), nullable=True))
    op.create_index("ix_conversation_members_hidden_at", "conversation_members", ["hidden_at"])


def downgrade() -> None:
    op.drop_index("ix_conversation_members_hidden_at", table_name="conversation_members")
    op.drop_column("conversation_members", "cleared_at")
    op.drop_column("conversation_members", "hidden_at")
