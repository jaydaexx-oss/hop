"""Events, event membership/invites, and conversation kind/archive columns."""

from alembic import op
import sqlalchemy as sa

revision = "003_events"
down_revision = "002_profile_photos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("kind", sa.String(), nullable=False, server_default="direct"),
    )
    op.add_column("conversations", sa.Column("archived_at", sa.DateTime(), nullable=True))
    op.create_index("ix_conversations_kind", "conversations", ["kind"])

    op.create_table(
        "events",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("host_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(length=48), nullable=False),
        sa.Column("starts_at", sa.DateTime(), nullable=False),
        sa.Column("ends_at", sa.DateTime(), nullable=False),
        sa.Column("visibility", sa.String(), nullable=False, server_default="invite_only"),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.Column("conversation_id", sa.String(length=36), sa.ForeignKey("conversations.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_events_host_id", "events", ["host_id"])
    op.create_index("ix_events_conversation_id", "events", ["conversation_id"])

    op.create_table(
        "event_members",
        sa.Column("event_id", sa.String(length=36), sa.ForeignKey("events.id"), primary_key=True),
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("role", sa.String(), nullable=False, server_default="guest"),
        sa.Column("joined_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "event_invites",
        sa.Column("event_id", sa.String(length=36), sa.ForeignKey("events.id"), primary_key=True),
        sa.Column("invitee_id", sa.String(length=36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("inviter_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("responded_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("event_invites")
    op.drop_table("event_members")
    op.drop_table("events")
    op.drop_index("ix_conversations_kind", table_name="conversations")
    op.drop_column("conversations", "archived_at")
    op.drop_column("conversations", "kind")
