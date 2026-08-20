from __future__ import annotations

import os
import re
from datetime import timedelta

from fastapi import HTTPException, Request
from sqlmodel import Session, select

from app.models.tables import BlockInstallCooldown, BlockedUser, Device, User, utcnow
from app.security import hash_token

INSTALL_HEADER = "x-hop-install"
_INSTALL_HEX = re.compile(r"^[0-9a-f]{64}$")
CONTACT_DENIED = "Cannot contact this user"
BLOCK_INSTALL_COOLDOWN_S = float(os.environ.get("BLOCK_INSTALL_COOLDOWN_S", str(7 * 24 * 60 * 60)))


def parse_install_hash(request: Request) -> str | None:
    """Hash-at-rest of the client SHA-256 install header. None if missing or malformed."""
    raw = (request.headers.get(INSTALL_HEADER) or "").strip().lower()
    if not _INSTALL_HEX.fullmatch(raw):
        return None
    return hash_token(raw)


def is_blocked(session: Session, user_a: str, user_b: str) -> bool:
    return (
        session.get(BlockedUser, (user_a, user_b)) is not None
        or session.get(BlockedUser, (user_b, user_a)) is not None
    )


def _device_install_hash(session: Session, user_id: str) -> str | None:
    device = session.exec(select(Device).where(Device.user_id == user_id)).first()
    if device is None or not device.install_hash:
        return None
    return device.install_hash


def install_in_cooldown(session: Session, actor: User, peer: User) -> bool:
    """True when peer recently blocked another account from actor's hashed install id."""
    install_hash = _device_install_hash(session, actor.id)
    if not install_hash:
        return False
    row = session.get(BlockInstallCooldown, (peer.id, install_hash))
    if row is None:
        return False
    age = utcnow() - row.created_at
    return age <= timedelta(seconds=BLOCK_INSTALL_COOLDOWN_S)


def assert_contact_allowed(session: Session, actor: User, peer: User, *, detail: str = CONTACT_DENIED) -> None:
    if actor.id == peer.id:
        return
    if is_blocked(session, actor.id, peer.id) or install_in_cooldown(session, actor, peer):
        raise HTTPException(status_code=403, detail=detail)


def record_block_install_cooldown(session: Session, blocker: User, blocked: User) -> None:
    install_hash = _device_install_hash(session, blocked.id)
    if not install_hash:
        return
    existing = session.get(BlockInstallCooldown, (blocker.id, install_hash))
    now = utcnow()
    if existing is None:
        session.add(
            BlockInstallCooldown(
                blocker_id=blocker.id,
                install_hash=install_hash,
                blocked_user_id=blocked.id,
                created_at=now,
            )
        )
        return
    existing.blocked_user_id = blocked.id
    existing.created_at = now
    session.add(existing)
