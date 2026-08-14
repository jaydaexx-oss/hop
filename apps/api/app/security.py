from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone

from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlmodel import Session, select

from app.db import get_session
from app.models.tables import Session as AuthSession
from app.models.tables import User, utcnow

USERNAME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{2,19}$")
bearer = HTTPBearer(auto_error=False)
PBKDF_ROUNDS = 120_000
SESSION_DAYS = 30
ARGON2_PREFIX = "argon2id$"
_password_hasher = PasswordHasher(time_cost=2, memory_cost=65536, parallelism=1)


def normalize_username(username: str) -> str:
    return username.strip().lower()


def validate_username(username: str) -> str:
    value = normalize_username(username)
    if not USERNAME_RE.match(value):
        raise HTTPException(
            status_code=400,
            detail="Username must be 3–20 characters, start with a letter, and use only letters, numbers, or _",
        )
    return value


def hash_password(password: str) -> str:
    return f"{ARGON2_PREFIX}{_password_hasher.hash(password)}"


def verify_password(password: str, stored: str) -> bool:
    if stored.startswith(ARGON2_PREFIX):
        try:
            _password_hasher.verify(stored[len(ARGON2_PREFIX) :], password)
            return True
        except VerifyMismatchError:
            return False
    try:
        algo, rounds, salt, digest = stored.split("$")
        if algo != "pbkdf2":
            return False
        check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(rounds)).hex()
        return hmac.compare_digest(check, digest)
    except ValueError:
        return False


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(session: Session, user: User) -> str:
    token = secrets.token_urlsafe(32)
    row = AuthSession(
        user_id=user.id,
        token_hash=hash_token(token),
        expires_at=utcnow() + timedelta(days=SESSION_DAYS),
    )
    session.add(row)
    session.commit()
    return token


def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    session: Session = Depends(get_session),
) -> User:
    if creds is None or creds.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Not authenticated")
    row = session.exec(select(AuthSession).where(AuthSession.token_hash == hash_token(creds.credentials))).first()
    if row is None or row.expires_at < utcnow():
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = session.get(User, row.user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="Invalid session")
    return user


def user_from_token(session: Session, token: str) -> User:
    row = session.exec(select(AuthSession).where(AuthSession.token_hash == hash_token(token))).first()
    if row is None or row.expires_at < utcnow():
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = session.get(User, row.user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="Invalid session")
    return user
