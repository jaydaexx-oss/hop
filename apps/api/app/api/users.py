from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.db import get_session
from app.identity_keys import is_well_formed_box_public_key
from app.models.tables import BlockedUser, Device, Report, User
from app.schemas import BlockIn, IdentityIn, ReportIn, UserOut
from app.security import get_current_user, validate_username

router = APIRouter(prefix="/users", tags=["users"])


def _user_out(session: Session, user: User) -> UserOut:
    device = session.exec(select(Device).where(Device.user_id == user.id)).first()
    return UserOut(
        id=user.id,
        username=user.username,
        created_at=user.created_at,
        identity_public_key=device.identity_public_key if device else "",
    )


@router.get("/me", response_model=UserOut)
def me(session: Session = Depends(get_session), user: User = Depends(get_current_user)) -> UserOut:
    return _user_out(session, user)


@router.put("/me/identity", response_model=UserOut)
def put_identity(
    body: IdentityIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> UserOut:
    public_key = body.public_key.strip()
    if not is_well_formed_box_public_key(public_key):
        raise HTTPException(status_code=400, detail="Malformed identity public key")
    taken = session.exec(select(Device).where(Device.identity_public_key == public_key)).first()
    if taken is not None and taken.user_id != user.id:
        raise HTTPException(status_code=409, detail="Identity public key already published by another account")
    device = session.exec(select(Device).where(Device.user_id == user.id)).first()
    if device is None:
        device = Device(user_id=user.id, platform="mobile", identity_public_key=public_key)
        session.add(device)
    elif device.identity_public_key and device.identity_public_key != public_key:
        raise HTTPException(
            status_code=409,
            detail=(
                "SERVER_KEY_LOCKED: this account already published a different identity "
                "public key. HOP will not replace it. Recovery is a new account, or a "
                "future rotation API that proves possession of the old secret."
            ),
        )
    else:
        device.identity_public_key = public_key
        session.add(device)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(
            status_code=409,
            detail="SERVER_KEY_LOCKED: this account already published a different identity public key.",
        ) from None
    return _user_out(session, user)


@router.get("/id/{user_id}", response_model=UserOut)
def get_user_by_id(
    user_id: str,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> UserOut:
    found = session.get(User, user_id)
    if found is None or found.deleted_at is not None:
        raise HTTPException(status_code=404, detail="User not found")
    return _user_out(session, found)


@router.post("/me/blocks")
def block_user(
    body: BlockIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    handle = validate_username(body.username)
    if handle == user.username:
        raise HTTPException(status_code=400, detail="Cannot block yourself")
    peer = session.exec(select(User).where(User.username == handle)).first()
    if peer is None:
        raise HTTPException(status_code=404, detail="User not found")
    existing = session.get(BlockedUser, (user.id, peer.id))
    if existing is None:
        session.add(BlockedUser(user_id=user.id, blocked_user_id=peer.id))
        session.commit()
    return {"status": "ok"}


@router.get("/me/blocks")
def list_blocks(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, list[str]]:
    rows = session.exec(select(BlockedUser).where(BlockedUser.user_id == user.id)).all()
    names: list[str] = []
    for row in rows:
        peer = session.get(User, row.blocked_user_id)
        if peer and peer.deleted_at is None:
            names.append(peer.username)
    return {"usernames": names}


@router.delete("/me/blocks/{username}")
def unblock_user(
    username: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    handle = validate_username(username)
    peer = session.exec(select(User).where(User.username == handle)).first()
    if peer is None:
        raise HTTPException(status_code=404, detail="User not found")
    existing = session.get(BlockedUser, (user.id, peer.id))
    if existing is not None:
        session.delete(existing)
        session.commit()
    return {"status": "ok"}


REPORT_CATEGORIES = {"spam", "harassment", "impersonation", "other"}


@router.post("/me/reports")
def report_user(
    body: ReportIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    category = body.category.strip().lower()
    if category not in REPORT_CATEGORIES:
        raise HTTPException(status_code=400, detail="Unknown report category")
    handle = validate_username(body.username)
    if handle == user.username:
        raise HTTPException(status_code=400, detail="Cannot report yourself")
    peer = session.exec(select(User).where(User.username == handle)).first()
    if peer is None:
        raise HTTPException(status_code=404, detail="User not found")
    note = (body.note or "").strip()[:200]
    reason = category if not note else f"{category}: {note}"
    session.add(Report(reporter_id=user.id, reported_user_id=peer.id, reason=reason))
    session.commit()
    return {"status": "ok"}


@router.get("/{username}", response_model=UserOut)
def get_user(
    username: str,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> UserOut:
    handle = validate_username(username)
    found = session.exec(select(User).where(User.username == handle)).first()
    if found is None or found.deleted_at is not None:
        raise HTTPException(status_code=404, detail="User not found")
    return _user_out(session, found)
