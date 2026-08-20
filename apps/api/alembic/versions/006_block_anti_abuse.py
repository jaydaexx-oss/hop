"""Hashed install ids on devices and block-install cooldowns."""

from alembic import op
import sqlalchemy as sa

revision = "006_block_anti_abuse"
down_revision = "005_identity_recovery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("install_hash", sa.String(length=64), nullable=True))
    op.create_index("ix_devices_install_hash", "devices", ["install_hash"])
    op.create_table(
        "block_install_cooldowns",
        sa.Column("blocker_id", sa.String(length=36), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("install_hash", sa.String(length=64), primary_key=True),
        sa.Column("blocked_user_id", sa.String(length=36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("block_install_cooldowns")
    op.drop_index("ix_devices_install_hash", table_name="devices")
    op.drop_column("devices", "install_hash")
