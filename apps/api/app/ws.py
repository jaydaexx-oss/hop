from __future__ import annotations

from fastapi import WebSocket

from app.models.tables import Message
from app.payload import decode_text
from app.schemas import MessageOut


class ConnectionHub:
    def __init__(self) -> None:
        self._clients: dict[str, set[WebSocket]] = {}

    async def connect(self, user_id: str, ws: WebSocket) -> None:
        self._clients.setdefault(user_id, set()).add(ws)

    def disconnect(self, user_id: str, ws: WebSocket) -> None:
        group = self._clients.get(user_id)
        if not group:
            return
        group.discard(ws)
        if not group:
            self._clients.pop(user_id, None)

    def is_connected(self, user_id: str) -> bool:
        return bool(self._clients.get(user_id))

    async def send_json(self, user_id: str, payload: dict) -> bool:
        sockets = list(self._clients.get(user_id, ()))
        delivered = False
        for ws in sockets:
            try:
                await ws.send_json(payload)
                delivered = True
            except Exception:
                self.disconnect(user_id, ws)
        return delivered


hub = ConnectionHub()


def message_event(message: Message) -> dict:
    body = MessageOut(
        message_id=message.id,
        sender_id=message.sender_id,
        recipient_id=message.recipient_id,
        conversation_id=message.conversation_id,
        encrypted_payload=message.encrypted_payload,
        text=decode_text(message.encrypted_payload),
        created_at=message.created_at,
        expires_at=message.expires_at,
        ttl=message.ttl,
        hop_count=message.hop_count,
        transport=message.transport,
        status=message.status,
        e2ee=False,
    )
    return {"type": "message", "message": body.model_dump(mode="json")}
