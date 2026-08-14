from __future__ import annotations

from fastapi import APIRouter, Response

from app.config import get_settings
from app.metrics import READY

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
def ready(response: Response) -> dict[str, str]:
    database = "ok" if _database_ok() else "error"
    cache = "ok" if _redis_ok() else "error"
    status = "ready" if database == "ok" and cache == "ok" else "not_ready"
    READY.set(1 if status == "ready" else 0)
    if status != "ready":
        response.status_code = 503
    return {
        "status": status,
        "database": database,
        "redis": cache,
        "version": get_settings().app_version,
    }


@router.get("/live")
def live() -> dict[str, str]:
    return {"status": "alive", "service": "hop-api"}
