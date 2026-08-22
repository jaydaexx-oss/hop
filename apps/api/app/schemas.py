from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_serializer


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


class RegisterDeviceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str
    public_key: str = Field(min_length=32, max_length=128)
    device_secret: str = Field(min_length=32, max_length=128)


class DeviceSessionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_secret: str = Field(min_length=32, max_length=128)


class HandleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str


class HandleAvailableOut(BaseModel):
    username: str
    available: bool


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: str
    username: str
    created_at: datetime
    identity_public_key: str = ""
    has_avatar: bool = False
    avatar_url: Optional[str] = None


class AuthOut(BaseModel):
    token: str
    user: UserOut


class RecoveryOptionsOut(BaseModel):
    username: str
    available: bool
    passkey_enrolled: bool = False
    legacy_password: bool = False


class RecoverPasswordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str
    password: str = Field(min_length=8, max_length=200)


class RecoverBindDeviceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_secret: str = Field(min_length=32, max_length=128)


class DevAccountCreationResetOut(BaseModel):
    status: str
    cleared: list[str]
    blocks_unchanged: bool = True


class RecoveryAuthOut(AuthOut):
    needs_passkey_enrollment: bool = False


class PasskeyBeginIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: Optional[str] = None


class PasskeyBeginOut(BaseModel):
    challenge_id: str
    options: dict


class PasskeyCompleteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    challenge_id: str
    credential: dict


class IdentityWrapIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wrapped_blob: str = Field(min_length=32, max_length=16384)


class IdentityWrapOut(BaseModel):
    wrapped_blob: str
    alg: str


class ConversationCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=20)


class MemberOut(BaseModel):
    id: str
    username: str
    identity_public_key: str = ""
    has_avatar: bool = False
    avatar_url: Optional[str] = None


class ConversationOut(BaseModel):
    id: str
    created_at: datetime
    peer: MemberOut
    kind: Literal["direct", "event"] = "direct"
    title: Optional[str] = None
    event_id: Optional[str] = None
    archived: bool = False
    my_role: Optional[Literal["host", "guest"]] = None
    members: list[MemberOut] = Field(default_factory=list)


class EventMessageCopyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recipient_id: str = Field(min_length=1, max_length=36)
    encrypted_payload: str = Field(min_length=32, max_length=65536)
    message_id: Optional[str] = Field(
        default=None,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        max_length=36,
    )


class TextMessageIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Opaque libsodium crypto_box JSON only. Private-chat voice uses the same envelope
    # (clients cap clips at 2 minutes). Event copies stay on the 64KiB budget. No plaintext audio.
    encrypted_payload: Optional[str] = Field(default=None, min_length=32, max_length=1_048_576)
    message_id: Optional[str] = Field(
        default=None,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        max_length=36,
    )
    recipient_id: Optional[str] = Field(default=None, min_length=1, max_length=36)
    copies: Optional[list[EventMessageCopyIn]] = Field(default=None, max_length=32)


class EventCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=48)
    starts_at: Optional[datetime] = None
    duration_ms: Optional[int] = Field(default=None, ge=60_000, le=24 * 60 * 60 * 1000)
    ends_at: Optional[datetime] = None
    visibility: Literal["invite_only", "discoverable"] = "invite_only"
    invite_usernames: list[str] = Field(default_factory=list, max_length=32)


class EventInviteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    usernames: list[str] = Field(min_length=1, max_length=32)


class EventMemberOut(BaseModel):
    id: str
    username: str
    role: Literal["host", "guest"]
    identity_public_key: str = ""
    has_avatar: bool = False
    avatar_url: Optional[str] = None


class EventInviteOut(BaseModel):
    invitee: MemberOut
    inviter_id: str
    status: Literal["pending", "accepted", "declined", "cancelled"]


class EventOut(BaseModel):
    id: str
    name: str
    host: EventMemberOut
    starts_at: datetime
    ends_at: datetime
    visibility: Literal["invite_only", "discoverable"]
    status: Literal["upcoming", "active", "ended"]
    row_status: Literal["active", "upcoming", "invited", "ended"]
    my_role: Optional[Literal["host", "guest", "invited"]] = None
    participant_count: int
    conversation_id: str
    conversation_archived: bool
    members: list[EventMemberOut] = Field(default_factory=list)
    pending_invites: list[EventInviteOut] = Field(default_factory=list)


class IdentityIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    public_key: str = Field(min_length=32, max_length=128)


class BlockIn(BaseModel):
    username: Optional[str] = None
    user_id: Optional[str] = None


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


class NearbyBroadcastIn(BaseModel):
    """Public nearby post. nearby_user_ids come from BLE discovery, never GPS."""

    model_config = ConfigDict(extra="forbid")
    id: Optional[str] = Field(
        default=None,
        pattern=r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        max_length=36,
    )
    body: str = Field(min_length=1, max_length=280)
    nearby_user_ids: list[str] = Field(default_factory=list, max_length=32)
    ttl_ms: Optional[int] = Field(default=None, ge=60_000, le=24 * 60 * 60 * 1000)


class NearbyBroadcastOut(BaseModel):
    id: str
    author_id: str
    display_name: str
    body: str
    created_at: datetime
    expires_at: datetime
    ttl_ms: int

    @field_serializer("created_at", "expires_at")
    def serialize_broadcast_timestamp(self, value: datetime) -> str:
        aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
        return aware.isoformat().replace("+00:00", "Z")
