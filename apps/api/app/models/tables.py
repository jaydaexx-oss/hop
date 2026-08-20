from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

import sqlalchemy as sa
from sqlmodel import Field, SQLModel


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: str = Field(default_factory=new_id, primary_key=True)
    username: str = Field(index=True, unique=True, max_length=20)
    password_hash: str
    created_at: datetime = Field(default_factory=utcnow)
    deleted_at: Optional[datetime] = None


class ProfilePhoto(SQLModel, table=True):
    __tablename__ = "profile_photos"

    user_id: str = Field(foreign_key="users.id", primary_key=True)
    jpeg_bytes: bytes = Field(sa_column=sa.Column(sa.LargeBinary, nullable=False))
    updated_at: datetime = Field(default_factory=utcnow)


class Device(SQLModel, table=True):
    __tablename__ = "devices"

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    platform: str
    identity_public_key: str = ""
    device_secret_hash: Optional[str] = Field(default=None, index=True, unique=True)
    created_at: datetime = Field(default_factory=utcnow)


class Conversation(SQLModel, table=True):
    __tablename__ = "conversations"

    id: str = Field(default_factory=new_id, primary_key=True)
    created_at: datetime = Field(default_factory=utcnow)
    kind: str = Field(default="direct", index=True)
    archived_at: Optional[datetime] = None


class Event(SQLModel, table=True):
    __tablename__ = "events"

    id: str = Field(default_factory=new_id, primary_key=True)
    host_id: str = Field(foreign_key="users.id", index=True)
    name: str = Field(max_length=48)
    starts_at: datetime
    ends_at: datetime
    visibility: str = Field(default="invite_only")
    ended_at: Optional[datetime] = None
    conversation_id: str = Field(foreign_key="conversations.id", index=True)
    created_at: datetime = Field(default_factory=utcnow)


class EventMember(SQLModel, table=True):
    __tablename__ = "event_members"

    event_id: str = Field(foreign_key="events.id", primary_key=True)
    user_id: str = Field(foreign_key="users.id", primary_key=True)
    role: str = Field(default="guest")
    joined_at: datetime = Field(default_factory=utcnow)


class EventInvite(SQLModel, table=True):
    __tablename__ = "event_invites"

    event_id: str = Field(foreign_key="events.id", primary_key=True)
    invitee_id: str = Field(foreign_key="users.id", primary_key=True)
    inviter_id: str = Field(foreign_key="users.id")
    status: str = Field(default="pending")
    created_at: datetime = Field(default_factory=utcnow)
    responded_at: Optional[datetime] = None


class ConversationMember(SQLModel, table=True):
    __tablename__ = "conversation_members"

    conversation_id: str = Field(foreign_key="conversations.id", primary_key=True)
    user_id: str = Field(foreign_key="users.id", primary_key=True)
    joined_at: datetime = Field(default_factory=utcnow)


class Message(SQLModel, table=True):
    __tablename__ = "messages"

    id: str = Field(primary_key=True)
    conversation_id: str = Field(foreign_key="conversations.id", index=True)
    sender_id: str = Field(foreign_key="users.id", index=True)
    recipient_id: str = Field(foreign_key="users.id", index=True)
    encrypted_payload: str
    created_at: datetime
    expires_at: datetime
    ttl: int
    hop_count: int = 0
    transport: str = "internet"
    status: str = "SENT"


class MessageDelivery(SQLModel, table=True):
    __tablename__ = "message_delivery"

    message_id: str = Field(foreign_key="messages.id", primary_key=True)
    recipient_user_id: str = Field(foreign_key="users.id", primary_key=True)
    status: str
    updated_at: datetime = Field(default_factory=utcnow)


class Session(SQLModel, table=True):
    __tablename__ = "sessions"

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(foreign_key="users.id", index=True)
    device_id: Optional[str] = Field(default=None, foreign_key="devices.id")
    token_hash: str = Field(index=True, unique=True)
    created_at: datetime = Field(default_factory=utcnow)
    expires_at: datetime


class BlockedUser(SQLModel, table=True):
    __tablename__ = "blocked_users"

    user_id: str = Field(foreign_key="users.id", primary_key=True)
    blocked_user_id: str = Field(foreign_key="users.id", primary_key=True)
    created_at: datetime = Field(default_factory=utcnow)


class Report(SQLModel, table=True):
    __tablename__ = "reports"

    id: str = Field(default_factory=new_id, primary_key=True)
    reporter_id: str = Field(foreign_key="users.id")
    reported_user_id: str = Field(foreign_key="users.id")
    reason: str
    created_at: datetime = Field(default_factory=utcnow)


class PasskeyCredential(SQLModel, table=True):
    __tablename__ = "passkey_credentials"

    id: str = Field(primary_key=True, max_length=512)
    user_id: str = Field(foreign_key="users.id", index=True)
    public_key: str
    sign_count: int = 0
    created_at: datetime = Field(default_factory=utcnow)


class PasskeyChallenge(SQLModel, table=True):
    __tablename__ = "passkey_challenges"

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: Optional[str] = Field(default=None, foreign_key="users.id", index=True)
    challenge: str
    purpose: str
    expires_at: datetime


class IdentityWrap(SQLModel, table=True):
    __tablename__ = "identity_wraps"

    user_id: str = Field(foreign_key="users.id", primary_key=True)
    wrapped_blob: str = Field(sa_column=sa.Column(sa.Text, nullable=False))
    alg: str = "crypto_box_xsalsa20poly1305"
    updated_at: datetime = Field(default_factory=utcnow)
