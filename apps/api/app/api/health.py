from __future__ import annotations

from fastapi import APIRouter

from app.config import get_settings

router = APIRouter(tags=["health"])


def _database_ok() -> bool:
    try:
        from sqlalchemy import text

        from app.db import get_engine

        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False


def _redis_ok() -> bool:
    try:
        import redis

        client = redis.from_url(get_settings().redis_url, socket_connect_timeout=0.5)
        return bool(client.ping())
    except Exception:
        return False


@router.get("/ready")
def ready() -> dict[str, str]:
    database = "ok" if _database_ok() else "error"
    cache = "ok" if _redis_ok() else "error"
    status = "ready" if database == "ok" else "not_ready"
    return {"status": status, "database": database, "redis": cache}
