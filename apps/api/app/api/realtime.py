from __future__ import annotations

from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from sqlmodel import Session

from app.db import get_engine
from app.security import user_from_token
from app.ws import hub
from fastapi import APIRouter

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str = "") -> None:
    if not token:
        await ws.close(code=4401)
        return
    with Session(get_engine()) as session:
        try:
            user = user_from_token(session, token)
        except HTTPException:
            await ws.close(code=4401)
            return
        user_id = user.id
    await ws.accept()
    await hub.connect(user_id, ws)
    try:
        await ws.send_json({"type": "hello", "user_id": user_id})
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(user_id, ws)
    except Exception:
        hub.disconnect(user_id, ws)
