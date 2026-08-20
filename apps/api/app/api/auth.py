from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlmodel import Session, select

from app.avatars import build_user_out
from app.db import get_session
from app.models.tables import Session as AuthSession
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
