from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.avatars import AVATAR_MEDIA_TYPE, build_user_out, validate_avatar_jpeg
from app.db import get_session
from app.identity_keys import is_well_formed_box_public_key
from app.models.tables import BlockedUser, Device, ProfilePhoto, Report, User, utcnow
from app.schemas import BlockIn, HandleIn, IdentityIn, ReportIn, UserOut
from app.security import get_current_user, validate_username

router = APIRouter(prefix="/users", tags=["users"])


def _user_out(session: Session, user: User) -> UserOut:
    return build_user_out(session, user)


@router.get("/me", response_model=UserOut)
def me(session: Session = Depends(get_session), user: User = Depends(get_current_user)) -> UserOut:
    return _user_out(session, user)


@router.put("/me/handle", response_model=UserOut)
def put_handle(
    body: HandleIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> UserOut:
    """Change display handle only. Does not rotate identity keys or user_id."""
    handle = validate_username(body.username)
    if handle == user.username:
        return _user_out(session, user)
    taken = session.exec(select(User).where(User.username == handle)).first()
    if taken is not None and taken.id != user.id:
        raise HTTPException(status_code=409, detail="Username already taken")
    user.username = handle
    session.add(user)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(status_code=409, detail="Username already taken") from None
    session.refresh(user)
    return _user_out(session, user)


@router.put("/me/avatar", response_model=UserOut)
async def put_avatar(
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> UserOut:
    content_type = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    if content_type not in {"image/jpeg", "image/jpg", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Profile photo must be a JPEG")
    data = validate_avatar_jpeg(await request.body())
    existing = session.get(ProfilePhoto, user.id)
    if existing is None:
        session.add(ProfilePhoto(user_id=user.id, jpeg_bytes=data, updated_at=utcnow()))
    else:
        existing.jpeg_bytes = data
        existing.updated_at = utcnow()
        session.add(existing)
    session.commit()
    return _user_out(session, user)


@router.delete("/me/avatar", response_model=UserOut)
def delete_avatar(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> UserOut:
    existing = session.get(ProfilePhoto, user.id)
    if existing is not None:
        session.delete(existing)
        session.commit()
    return _user_out(session, user)


@router.get("/id/{user_id}/avatar")
def get_avatar(
    user_id: str,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> Response:
    found = session.get(User, user_id)
    if found is None or found.deleted_at is not None:
        raise HTTPException(status_code=404, detail="User not found")
    photo = session.get(ProfilePhoto, user_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="No profile photo")
    return Response(
        content=photo.jpeg_bytes,
        media_type=AVATAR_MEDIA_TYPE,
        headers={"Cache-Control": "private, max-age=120"},
    )


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
