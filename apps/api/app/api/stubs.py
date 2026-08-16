from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["unimplemented"])

NOT_IMPLEMENTED = HTTPException(status_code=501, detail="Not implemented")


@router.get("/devices", deprecated=True, summary="Not implemented")
def list_devices() -> None:
    """Device registry is not implemented. Always 501."""
    raise NOT_IMPLEMENTED


@router.get("/sync", deprecated=True, summary="Not implemented")
def sync() -> None:
    """Server-side sync is not implemented. Always 501. Mobile uses SQLite + MessageService."""
    raise NOT_IMPLEMENTED


@router.post("/push/register", deprecated=True, summary="Not implemented")
def register_push() -> None:
    """Push notification registration is not implemented. Always 501."""
    raise NOT_IMPLEMENTED
