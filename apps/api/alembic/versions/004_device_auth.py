"""Device credential hash for passwordless installs. Existing devices keep NULL."""

from alembic import op
import sqlalchemy as sa

revision = "004_device_auth"
down_revision = "003_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("device_secret_hash", sa.String(), nullable=True))
    op.create_index("ix_devices_device_secret_hash", "devices", ["device_secret_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_devices_device_secret_hash", table_name="devices")
    op.drop_column("devices", "device_secret_hash")
