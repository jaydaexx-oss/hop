from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter()

NOT_IMPLEMENTED = HTTPException(status_code=501, detail="Not implemented")


@router.post("/auth/register")
def register() -> None:
    raise NOT_IMPLEMENTED


@router.post("/auth/login")
def login() -> None:
    raise NOT_IMPLEMENTED


@router.get("/users/me")
def users_me() -> None:
    raise NOT_IMPLEMENTED


@router.get("/devices")
def list_devices() -> None:
    raise NOT_IMPLEMENTED


@router.get("/conversations")
def list_conversations() -> None:
    raise NOT_IMPLEMENTED


@router.get("/messages")
def list_messages() -> None:
    raise NOT_IMPLEMENTED


@router.post("/messages")
def create_message() -> None:
    raise NOT_IMPLEMENTED


@router.post("/messages/acks")
def ack_message() -> None:
    raise NOT_IMPLEMENTED


@router.get("/sync")
def sync() -> None:
    raise NOT_IMPLEMENTED


@router.post("/push/register")
def register_push() -> None:
    raise NOT_IMPLEMENTED
