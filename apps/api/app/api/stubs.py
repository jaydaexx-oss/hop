from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter()

NOT_IMPLEMENTED = HTTPException(status_code=501, detail="Not implemented")


@router.get("/devices")
def list_devices() -> None:
    raise NOT_IMPLEMENTED


@router.get("/sync")
def sync() -> None:
    raise NOT_IMPLEMENTED


@router.post("/push/register")
def register_push() -> None:
    raise NOT_IMPLEMENTED
