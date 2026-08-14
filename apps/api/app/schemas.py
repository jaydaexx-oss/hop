from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from pydantic import BaseModel, Field


class EnvelopeIn(BaseModel):
    message_id: str
    sender_id: str
    recipient_id: str
    conversation_id: str
    encrypted_payload: str = Field(min_length=1)
    created_at: datetime
    expires_at: datetime
    ttl: int
    hop_count: int = 0
    transport: str = "internet"


class RegisterIn(BaseModel):
    username: str
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: str
    username: str
    created_at: datetime


class AuthOut(BaseModel):
    token: str
    user: UserOut


class ConversationCreateIn(BaseModel):
    username: str


class MemberOut(BaseModel):
    id: str
    username: str


class ConversationOut(BaseModel):
    id: str
    created_at: datetime
    peer: MemberOut


class TextMessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    message_id: Optional[str] = None


class AckIn(BaseModel):
    status: str


class MessageOut(BaseModel):
    message_id: str
    sender_id: str
    recipient_id: str
    conversation_id: str
    encrypted_payload: str
    text: Optional[str]
    created_at: datetime
    expires_at: datetime
    ttl: int
    hop_count: int
    transport: str
    status: str
    e2ee: bool = False
