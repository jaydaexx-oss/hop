from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.db import get_session
from app.models.tables import User
from app.schemas import UserOut
from app.security import get_current_user, validate_username

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut(id=user.id, username=user.username, created_at=user.created_at)


@router.get("/{username}", response_model=UserOut)
def get_user(
    username: str,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> UserOut:
    handle = validate_username(username)
    found = session.exec(select(User).where(User.username == handle)).first()
    if found is None:
        raise HTTPException(status_code=404, detail="User not found")
    return UserOut(id=found.id, username=found.username, created_at=found.created_at)
