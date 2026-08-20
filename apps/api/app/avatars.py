from __future__ import annotations

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models.tables import Device, ProfilePhoto, User
from app.schemas import MemberOut, UserOut

JPEG_MAGIC = b"\xff\xd8\xff"
AVATAR_MAX_BYTES = 262_144
AVATAR_MEDIA_TYPE = "image/jpeg"


def avatar_proxy_path(user_id: str) -> str:
    return f"/users/id/{user_id}/avatar"


def is_jpeg(data: bytes) -> bool:
    return len(data) >= 3 and data.startswith(JPEG_MAGIC)


def validate_avatar_jpeg(data: bytes) -> bytes:
    if len(data) > AVATAR_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Profile photo is too large")
    if len(data) < 32 or not is_jpeg(data):
        raise HTTPException(status_code=400, detail="Profile photo must be a JPEG")
    return data


def user_has_avatar(session: Session, user_id: str) -> bool:
    return session.get(ProfilePhoto, user_id) is not None


def identity_public_key(session: Session, user_id: str) -> str:
    device = session.exec(select(Device).where(Device.user_id == user_id)).first()
    return device.identity_public_key if device and device.identity_public_key else ""


def build_user_out(session: Session, user: User) -> UserOut:
    has_avatar = user_has_avatar(session, user.id)
    return UserOut(
        id=user.id,
        username=user.username,
        created_at=user.created_at,
        identity_public_key=identity_public_key(session, user.id),
        has_avatar=has_avatar,
        avatar_url=avatar_proxy_path(user.id) if has_avatar else None,
    )


def build_member_out(session: Session, user: User) -> MemberOut:
    has_avatar = user_has_avatar(session, user.id)
    return MemberOut(
        id=user.id,
        username=user.username,
        identity_public_key=identity_public_key(session, user.id),
        has_avatar=has_avatar,
        avatar_url=avatar_proxy_path(user.id) if has_avatar else None,
    )
