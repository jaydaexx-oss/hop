from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    handle: str = Field(index=True, unique=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    deleted_at: Optional[datetime] = None


class Device(SQLModel, table=True):
    __tablename__ = "devices"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    platform: str
    identity_public_key: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Conversation(SQLModel, table=True):
    __tablename__ = "conversations"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ConversationMember(SQLModel, table=True):
    __tablename__ = "conversation_members"

    conversation_id: uuid.UUID = Field(foreign_key="conversations.id", primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", primary_key=True)
    joined_at: datetime = Field(default_factory=datetime.utcnow)


class Message(SQLModel, table=True):
    __tablename__ = "messages"

    id: uuid.UUID = Field(primary_key=True)
    conversation_id: uuid.UUID = Field(foreign_key="conversations.id", index=True)
    sender_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    encrypted_payload: str
    created_at: datetime
    expires_at: datetime
    ttl: int
    hop_count: int = 0
    transport: str
    status: str


class MessageDelivery(SQLModel, table=True):
    __tablename__ = "message_delivery"

    message_id: uuid.UUID = Field(foreign_key="messages.id", primary_key=True)
    recipient_device_id: uuid.UUID = Field(foreign_key="devices.id", primary_key=True)
    status: str
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class Session(SQLModel, table=True):
    __tablename__ = "sessions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", index=True)
    device_id: uuid.UUID = Field(foreign_key="devices.id")
    token_hash: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime


class BlockedUser(SQLModel, table=True):
    __tablename__ = "blocked_users"

    user_id: uuid.UUID = Field(foreign_key="users.id", primary_key=True)
    blocked_user_id: uuid.UUID = Field(foreign_key="users.id", primary_key=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Report(SQLModel, table=True):
    __tablename__ = "reports"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    reporter_id: uuid.UUID = Field(foreign_key="users.id")
    reported_user_id: uuid.UUID = Field(foreign_key="users.id")
    reason: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
