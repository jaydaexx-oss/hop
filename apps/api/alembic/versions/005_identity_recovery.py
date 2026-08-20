"""Passkey credentials, recovery challenges, and opaque identity wraps."""

from alembic import op
import sqlalchemy as sa

revision = "005_identity_recovery"
down_revision = "004_device_auth"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "passkey_credentials",
        sa.Column("id", sa.String(length=512), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("public_key", sa.String(), nullable=False),
        sa.Column("sign_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_passkey_credentials_user_id", "passkey_credentials", ["user_id"])

    op.create_table(
        "passkey_challenges",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("challenge", sa.String(), nullable=False),
        sa.Column("purpose", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_passkey_challenges_user_id", "passkey_challenges", ["user_id"])

    op.create_table(
        "identity_wraps",
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("wrapped_blob", sa.Text(), nullable=False),
        sa.Column("alg", sa.String(), nullable=False, server_default="crypto_box_xsalsa20poly1305"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("identity_wraps")
    op.drop_index("ix_passkey_challenges_user_id", table_name="passkey_challenges")
    op.drop_table("passkey_challenges")
    op.drop_index("ix_passkey_credentials_user_id", table_name="passkey_credentials")
    op.drop_table("passkey_credentials")
