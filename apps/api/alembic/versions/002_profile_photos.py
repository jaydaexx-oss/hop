"""Add authenticated profile photo blobs (JPEG bytes, not a public object store)."""

from alembic import op
import sqlalchemy as sa

revision = "002_profile_photos"
down_revision = "001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "profile_photos",
        sa.Column("user_id", sa.String(length=36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("jpeg_bytes", sa.LargeBinary(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("profile_photos")
