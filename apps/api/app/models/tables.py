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
    created_at: datetime = Field(default_factory=utcnow)


class Conversation(SQLModel, table=True):
    __tablename__ = "conversations"

    id: str = Field(default_factory=new_id, primary_key=True)
    created_at: datetime = Field(default_factory=utcnow)


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
