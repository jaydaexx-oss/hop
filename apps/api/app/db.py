from __future__ import annotations

from collections.abc import Generator
from functools import lru_cache

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.config import get_settings


@lru_cache
def get_engine():
    url = get_settings().database_url
    if url.startswith("sqlite"):
        return create_engine(
            url,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
    return create_engine(url)


def init_db() -> bool:
    from app.models import tables  # noqa: F401 — register SQLModel metadata

    SQLModel.metadata.create_all(get_engine())
    return True


def get_session() -> Generator[Session, None, None]:
    with Session(get_engine()) as session:
        yield session
