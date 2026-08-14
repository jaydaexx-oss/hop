from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/ready")
def ready() -> dict[str, str]:
    """Liveness-only for now. Database readiness is not implemented."""
    return {"status": "ready", "database": "not_checked"}
