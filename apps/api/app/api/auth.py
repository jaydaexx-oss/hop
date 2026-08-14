from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlmodel import Session, select

from app.db import get_session
from app.models.tables import Device, Session as AuthSession
from app.models.tables import User
from app.rate_limit import limit_auth
from app.schemas import AuthOut, LoginIn, RegisterIn, UserOut
from app.security import (
    bearer,
    get_current_user,
    hash_password,
    hash_token,
    issue_token,
    validate_username,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def user_out(session: Session, user: User) -> UserOut:
    device = session.exec(select(Device).where(Device.user_id == user.id)).first()
    return UserOut(
        id=user.id,
        username=user.username,
        created_at=user.created_at,
        identity_public_key=device.identity_public_key if device else "",
    )


@router.post("/register", response_model=AuthOut)
def register(body: RegisterIn, request: Request, session: Session = Depends(get_session)) -> AuthOut:
    limit_auth(request)
    username = validate_username(body.username)
    existing = session.exec(select(User).where(User.username == username)).first()
    if existing:
        raise HTTPException(status_code=409, detail="Username already taken")
    user = User(username=username, password_hash=hash_password(body.password))
    session.add(user)
    session.commit()
    session.refresh(user)
    token = issue_token(session, user)
    return AuthOut(token=token, user=user_out(session, user))


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
