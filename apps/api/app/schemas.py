from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


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
    identity_public_key: str = ""


class AuthOut(BaseModel):
    token: str
    user: UserOut


class ConversationCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=20)


class MemberOut(BaseModel):
    id: str
    username: str
    identity_public_key: str = ""


class ConversationOut(BaseModel):
    id: str
    created_at: datetime
    peer: MemberOut


class TextMessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Opaque libsodium crypto_box JSON only. Voice uses the same envelope as text;
    # clients cap clips at ~8 seconds so boxed payloads fit. Plaintext audio is never stored.
    encrypted_payload: str = Field(min_length=32, max_length=65536)
    message_id: Optional[str] = Field(
        default=None,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        max_length=36,
    )


class IdentityIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    public_key: str = Field(min_length=32, max_length=128)


class BlockIn(BaseModel):
    username: str


class ReportIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str
    category: str = Field(min_length=3, max_length=32)
    note: Optional[str] = Field(default=None, max_length=200)


class AckIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str = Field(min_length=1, max_length=16)


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
