from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlmodel import Session, select

from app.avatars import build_user_out
from app.db import get_session
from app.identity_keys import is_well_formed_box_public_key
from app.models.tables import Device
from app.models.tables import Session as AuthSession
from app.models.tables import User
from app.rate_limit import limit_auth
from app.schemas import AuthOut, DeviceSessionIn, HandleAvailableOut, LoginIn, RegisterDeviceIn, RegisterIn, UserOut
from app.security import (
    DEVICE_PASSWORD_MARKER,
    bearer,
    get_current_user,
    hash_password,
    hash_token,
    is_device_account,
    issue_token,
    validate_username,
    verify_password,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


def user_out(session: Session, user: User) -> UserOut:
    return build_user_out(session, user)


@router.post("/register", response_model=AuthOut)
def register(body: RegisterIn, request: Request, session: Session = Depends(get_session)) -> AuthOut:
    limit_auth(request)
    username = validate_username(body.username)
    try:
        existing = session.exec(select(User).where(User.username == username)).first()
        if existing:
            raise HTTPException(status_code=409, detail="Username already taken")
        user = User(username=username, password_hash=hash_password(body.password))
        session.add(user)
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(status_code=409, detail="Username already taken") from None
        session.refresh(user)
        token = issue_token(session, user)
        return AuthOut(token=token, user=user_out(session, user))
    except HTTPException:
        raise
    except OperationalError:
        try:
            session.rollback()
        except Exception:
            pass
        logger.warning("register failed: database connection unavailable")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable") from None


def _issue_auth(session: Session, user: User) -> AuthOut:
    token = issue_token(session, user)
    return AuthOut(token=token, user=user_out(session, user))


@router.get("/handle-available", response_model=HandleAvailableOut)
def handle_available(username: str, request: Request, session: Session = Depends(get_session)) -> HandleAvailableOut:
    limit_auth(request)
    handle = validate_username(username)
    existing = session.exec(select(User).where(User.username == handle)).first()
    taken = existing is not None and existing.deleted_at is None
    return HandleAvailableOut(username=handle, available=not taken)


@router.post("/register-device", response_model=AuthOut)
def register_device(body: RegisterDeviceIn, request: Request, session: Session = Depends(get_session)) -> AuthOut:
    """Passwordless device registration. Same token format as /auth/register. Does not replace existing user_ids."""
    limit_auth(request)
    username = validate_username(body.username)
    public_key = body.public_key.strip()
    if not is_well_formed_box_public_key(public_key):
        raise HTTPException(status_code=400, detail="Malformed identity public key")
    device_secret_hash = hash_token(body.device_secret)
    try:
        by_secret = session.exec(select(Device).where(Device.device_secret_hash == device_secret_hash)).first()
        if by_secret is not None:
            user = session.get(User, by_secret.user_id)
            if user is None or user.deleted_at is not None:
                raise HTTPException(status_code=401, detail="Invalid device")
            if by_secret.identity_public_key and by_secret.identity_public_key != public_key:
                raise HTTPException(status_code=409, detail="Identity public key already published by this device")
            if user.username != username:
                taken = session.exec(select(User).where(User.username == username)).first()
                if taken is not None and taken.id != user.id:
                    raise HTTPException(status_code=409, detail="Username already taken")
                user.username = username
                session.add(user)
            if not by_secret.identity_public_key:
                by_secret.identity_public_key = public_key
                session.add(by_secret)
            session.commit()
            session.refresh(user)
            return _issue_auth(session, user)

        by_key = session.exec(select(Device).where(Device.identity_public_key == public_key)).first()
        if by_key is not None:
            raise HTTPException(status_code=409, detail="Identity public key already published by another account")

        existing = session.exec(select(User).where(User.username == username)).first()
        if existing is not None:
            raise HTTPException(status_code=409, detail="Username already taken")

        user = User(username=username, password_hash=DEVICE_PASSWORD_MARKER)
        session.add(user)
        session.flush()
        session.add(
            Device(
                user_id=user.id,
                platform="mobile",
                identity_public_key=public_key,
                device_secret_hash=device_secret_hash,
            )
        )
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            raise HTTPException(status_code=409, detail="Username already taken") from None
        session.refresh(user)
        return _issue_auth(session, user)
    except HTTPException:
        raise
    except OperationalError:
        try:
            session.rollback()
        except Exception:
            pass
        logger.warning("register-device failed: database connection unavailable")
        raise HTTPException(status_code=503, detail="Service temporarily unavailable") from None


@router.post("/device", response_model=AuthOut)
def device_session(body: DeviceSessionIn, request: Request, session: Session = Depends(get_session)) -> AuthOut:
    """Re-issue a session for an existing device credential. Never creates a user."""
    limit_auth(request)
    device = session.exec(select(Device).where(Device.device_secret_hash == hash_token(body.device_secret))).first()
    if device is None:
        raise HTTPException(status_code=401, detail="Invalid device")
    user = session.get(User, device.user_id)
    if user is None or user.deleted_at is not None or not is_device_account(user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid device")
    return _issue_auth(session, user)


@router.post("/login", response_model=AuthOut)
def login(body: LoginIn, request: Request, session: Session = Depends(get_session)) -> AuthOut:
    limit_auth(request)
    username = validate_username(body.username)
    user = session.exec(select(User).where(User.username == username)).first()
    if user is None or user.deleted_at is not None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = issue_token(session, user)
    return AuthOut(token=token, user=user_out(session, user))


@router.post("/logout")
def logout(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    if creds is not None:
        row = session.exec(select(AuthSession).where(AuthSession.token_hash == hash_token(creds.credentials))).first()
        if row is not None:
            session.delete(row)
            session.commit()
    return {"status": "ok"}
