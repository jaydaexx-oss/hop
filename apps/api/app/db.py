from __future__ import annotations

import logging
from collections.abc import Generator
from functools import lru_cache

from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.config import get_settings
from app.db_url import normalize_database_url

logger = logging.getLogger(__name__)

# Fly Postgres drops idle clients. /health does not check out this pool, so the
# first POST /auth/register after idle used a dead connection and returned 500.
POSTGRES_POOL_PRE_PING = True
POSTGRES_POOL_RECYCLE_S = 300


def postgres_engine_options() -> dict[str, int | bool]:
    return {"pool_pre_ping": POSTGRES_POOL_PRE_PING, "pool_recycle": POSTGRES_POOL_RECYCLE_S}


@lru_cache
def get_engine():
    settings = get_settings()
    url = normalize_database_url(
        settings.database_url,
        allow_sqlite=not settings.is_production,
    )
    if url.startswith("sqlite"):
        return create_engine(
            url,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
    return create_engine(url, **postgres_engine_options())


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
