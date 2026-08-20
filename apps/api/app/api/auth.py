from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlmodel import Session, select

from app.avatars import build_user_out, identity_public_key
from app.blocks import parse_install_hash, record_block_install_cooldown
from app.db import get_session
from app.identity_keys import is_well_formed_box_public_key
from app.models.tables import BlockedUser, Device
from app.models.tables import Session as AuthSession
from app.models.tables import User
from app import passkeys
from app.rate_limit import limit_auth, limit_new_account
from app.schemas import (
    AuthOut,
    DeviceSessionIn,
    HandleAvailableOut,
    LoginIn,
    PasskeyBeginIn,
    PasskeyBeginOut,
    PasskeyCompleteIn,
    RecoverBindDeviceIn,
    RecoverPasswordIn,
    RecoveryAuthOut,
    RecoveryOptionsOut,
    RegisterDeviceIn,
    RegisterIn,
    UserOut,
)
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
        limit_new_account(request, parse_install_hash(request))
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


def _recovery_auth(session: Session, user: User) -> RecoveryAuthOut:
    issued = _issue_auth(session, user)
    return RecoveryAuthOut(
        token=issued.token,
        user=issued.user,
        needs_passkey_enrollment=not passkeys.has_passkey(session, user.id),
    )


def _bind_device_for_user(session: Session, user: User, device_secret: str) -> Device:
    """Attach a new device credential to an existing user. Never changes identity_public_key."""
    device_secret_hash = hash_token(device_secret)
    by_secret = session.exec(select(Device).where(Device.device_secret_hash == device_secret_hash)).first()
    if by_secret is not None:
        if by_secret.user_id != user.id:
            raise HTTPException(status_code=409, detail="Device credential already registered to another account")
        return by_secret
    published = identity_public_key(session, user.id)
    session.add(
        Device(
            user_id=user.id,
            platform="mobile",
            identity_public_key=published,
            device_secret_hash=device_secret_hash,
        )
    )
    session.commit()
    bound = session.exec(select(Device).where(Device.device_secret_hash == device_secret_hash)).first()
    if bound is None:
        raise HTTPException(status_code=500, detail="Could not bind device")
    return bound


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
            install_hash = parse_install_hash(request)
            if install_hash and by_secret.install_hash != install_hash:
                by_secret.install_hash = install_hash
                for row in session.exec(select(BlockedUser).where(BlockedUser.blocked_user_id == user.id)).all():
                    blocker = session.get(User, row.user_id)
                    if blocker is not None:
                        record_block_install_cooldown(session, blocker, user)
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

        install_hash = parse_install_hash(request)
        limit_new_account(request, install_hash)
        user = User(username=username, password_hash=DEVICE_PASSWORD_MARKER)
        session.add(user)
        session.flush()
        session.add(
            Device(
                user_id=user.id,
                platform="mobile",
                identity_public_key=public_key,
                device_secret_hash=device_secret_hash,
                install_hash=install_hash,
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
    if user is None or user.deleted_at is not None:
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


@router.get("/recovery-options", response_model=RecoveryOptionsOut)
def recovery_options(username: str, request: Request, session: Session = Depends(get_session)) -> RecoveryOptionsOut:
    """Lookup only. Handle existence is not authentication."""
    limit_auth(request)
    handle = validate_username(username)
    existing = session.exec(select(User).where(User.username == handle)).first()
    if existing is None or existing.deleted_at is not None:
        return RecoveryOptionsOut(username=handle, available=True, passkey_enrolled=False, legacy_password=False)
    return RecoveryOptionsOut(
        username=handle,
        available=False,
        passkey_enrolled=passkeys.has_passkey(session, existing.id),
        legacy_password=not is_device_account(existing.password_hash),
    )


@router.post("/recover/password", response_model=RecoveryAuthOut)
def recover_password(body: RecoverPasswordIn, request: Request, session: Session = Depends(get_session)) -> RecoveryAuthOut:
    """One-time proof for pre-passkey accounts. Does not create a user or rotate identity keys."""
    limit_auth(request)
    username = validate_username(body.username)
    user = session.exec(select(User).where(User.username == username)).first()
    if user is None or user.deleted_at is not None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return _recovery_auth(session, user)


@router.post("/recover/bind-device", response_model=AuthOut)
def recover_bind_device(
    body: RecoverBindDeviceIn,
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> AuthOut:
    """Issue a new device_secret for this device bound to the recovered user_id. No public key accepted."""
    limit_auth(request)
    _bind_device_for_user(session, user, body.device_secret)
    return _issue_auth(session, user)


@router.post("/passkey/register/begin", response_model=PasskeyBeginOut)
def passkey_register_begin(
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> PasskeyBeginOut:
    limit_auth(request)
    payload = passkeys.registration_begin(session, user, request)
    return PasskeyBeginOut(challenge_id=payload["challenge_id"], options=payload["options"])


@router.post("/passkey/register/complete", response_model=RecoveryAuthOut)
def passkey_register_complete(
    body: PasskeyCompleteIn,
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> RecoveryAuthOut:
    limit_auth(request)
    passkeys.registration_complete(session, user, request, body.challenge_id, body.credential)
    return _recovery_auth(session, user)


@router.post("/passkey/authenticate/begin", response_model=PasskeyBeginOut)
def passkey_authenticate_begin(
    body: PasskeyBeginIn,
    request: Request,
    session: Session = Depends(get_session),
) -> PasskeyBeginOut:
    limit_auth(request)
    if not body.username:
        raise HTTPException(status_code=400, detail="Username is required")
    username = validate_username(body.username)
    user = session.exec(select(User).where(User.username == username)).first()
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=404, detail="No passkey enrolled")
    payload = passkeys.authentication_begin(session, user, request)
    return PasskeyBeginOut(challenge_id=payload["challenge_id"], options=payload["options"])


@router.post("/passkey/authenticate/complete", response_model=RecoveryAuthOut)
def passkey_authenticate_complete(
    body: PasskeyCompleteIn,
    request: Request,
    session: Session = Depends(get_session),
) -> RecoveryAuthOut:
    limit_auth(request)
    user = passkeys.authentication_complete(session, request, body.challenge_id, body.credential)
    return _recovery_auth(session, user)
