from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["unimplemented"])

NOT_IMPLEMENTED = HTTPException(status_code=501, detail="Not implemented")
PUSH_NOT_OFFERED = HTTPException(status_code=404, detail="Push is not offered")


@router.get("/devices", deprecated=True, summary="Not implemented")
def list_devices() -> None:
    """Device registry is not implemented. Always 501."""
    raise NOT_IMPLEMENTED


@router.get("/sync", deprecated=True, summary="Not implemented")
def sync() -> None:
    """Server-side sync is not implemented. Always 501. Mobile uses SQLite + MessageService."""
    raise NOT_IMPLEMENTED


@router.post(
    "/push/register",
    include_in_schema=False,
    summary="Push is not offered",
)
def register_push() -> None:
    """Push notifications are not a HOP product. Always 404. Do not advertise as implemented."""
    raise PUSH_NOT_OFFERED
