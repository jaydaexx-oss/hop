from __future__ import annotations

import logging
from collections.abc import Generator
from functools import lru_cache

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.config import get_settings

logger = logging.getLogger(__name__)


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
    """Create tables in development/test only. Production schema is Alembic-only."""
    from app.models import tables  # noqa: F401 — register SQLModel metadata

    settings = get_settings()
    if settings.is_production:
        logger.info("Skipping create_all; production schema is applied by Alembic")
        return False
    SQLModel.metadata.create_all(get_engine())
    return True


def get_session() -> Generator[Session, None, None]:
    with Session(get_engine()) as session:
        yield session
