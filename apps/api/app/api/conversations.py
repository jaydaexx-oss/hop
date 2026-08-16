from __future__ import annotations

from datetime import timedelta

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, col, select

from app.db import get_session
from app.models.tables import (
    BlockedUser,
    Conversation,
    ConversationMember,
    Device,
    Message,
    MessageDelivery,
    User,
    new_id,
    utcnow,
)
from app.payload import is_crypto_box_payload
from app.rate_limit import limit_messages
from app.schemas import AckIn, ConversationCreateIn, ConversationOut, MemberOut, MessageOut, TextMessageIn
from app.security import get_current_user, validate_username
from app.ws import hub, message_event

router = APIRouter(tags=["conversations"])

DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000


def identity_public_key(session: Session, user_id: str) -> str:
    device = session.exec(select(Device).where(Device.user_id == user_id)).first()
    return device.identity_public_key if device and device.identity_public_key else ""


def is_blocked(session: Session, user_a: str, user_b: str) -> bool:
    return (
        session.get(BlockedUser, (user_a, user_b)) is not None
        or session.get(BlockedUser, (user_b, user_a)) is not None
    )


def _peer(session: Session, conversation_id: str, me: User) -> User:
    members = session.exec(
        select(ConversationMember).where(ConversationMember.conversation_id == conversation_id)
    ).all()
    other_ids = [m.user_id for m in members if m.user_id != me.id]
    if len(members) != 2 or len(other_ids) != 1:
        raise HTTPException(status_code=400, detail="Only one-to-one chats are supported")
    peer = session.get(User, other_ids[0])
    if peer is None:
        raise HTTPException(status_code=404, detail="Peer not found")
    return peer


def _require_member(session: Session, conversation_id: str, user: User) -> Conversation:
    convo = session.get(Conversation, conversation_id)
    if convo is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    membership = session.get(ConversationMember, (conversation_id, user.id))
    if membership is None:
        raise HTTPException(status_code=403, detail="Not a member of this conversation")
    return convo


def _message_out(row: Message) -> MessageOut:
    boxed = is_crypto_box_payload(row.encrypted_payload)
    return MessageOut(
        message_id=row.id,
        sender_id=row.sender_id,
        recipient_id=row.recipient_id,
        conversation_id=row.conversation_id,
        encrypted_payload=row.encrypted_payload,
        text=None,
        created_at=row.created_at,
        expires_at=row.expires_at,
        ttl=row.ttl,
        hop_count=row.hop_count,
        transport=row.transport,
        status=row.status,
        e2ee=boxed,
    )


def _conversation_out(session: Session, convo: Conversation, me: User) -> ConversationOut:
    peer = _peer(session, convo.id, me)
    return ConversationOut(
        id=convo.id,
        created_at=convo.created_at,
        peer=MemberOut(
            id=peer.id,
            username=peer.username,
            identity_public_key=identity_public_key(session, peer.id),
        ),
    )


def _find_direct(session: Session, user_a: str, user_b: str) -> Optional[Conversation]:
    mine = session.exec(select(ConversationMember.conversation_id).where(ConversationMember.user_id == user_a)).all()
    if not mine:
        return None
    for convo_id in mine:
        members = session.exec(select(ConversationMember).where(ConversationMember.conversation_id == convo_id)).all()
        ids = {m.user_id for m in members}
        if ids == {user_a, user_b}:
            return session.get(Conversation, convo_id)
    return None


@router.post("/conversations", response_model=ConversationOut)
def create_conversation(
    body: ConversationCreateIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ConversationOut:
    username = validate_username(body.username)
    if username == user.username:
        raise HTTPException(status_code=400, detail="Cannot chat with yourself")
    peer = session.exec(select(User).where(User.username == username)).first()
    if peer is None:
        raise HTTPException(status_code=404, detail="User not found")
    if is_blocked(session, user.id, peer.id):
        raise HTTPException(status_code=403, detail="Cannot start a conversation with this user")
    existing = _find_direct(session, user.id, peer.id)
    if existing:
        return _conversation_out(session, existing, user)
    convo = Conversation()
    session.add(convo)
    session.commit()
    session.refresh(convo)
    session.add(ConversationMember(conversation_id=convo.id, user_id=user.id))
    session.add(ConversationMember(conversation_id=convo.id, user_id=peer.id))
    session.commit()
    return _conversation_out(session, convo, user)


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[ConversationOut]:
    memberships = session.exec(select(ConversationMember).where(ConversationMember.user_id == user.id)).all()
    out: list[ConversationOut] = []
    for membership in memberships:
        convo = session.get(Conversation, membership.conversation_id)
        if convo:
            out.append(_conversation_out(session, convo, user))
    out.sort(key=lambda item: item.created_at, reverse=True)
    return out


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
def list_messages(
    conversation_id: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[MessageOut]:
    _require_member(session, conversation_id, user)
    now = utcnow()
    rows = session.exec(
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .where(Message.expires_at > now)
        .order_by(col(Message.created_at))
    ).all()
    return [_message_out(row) for row in rows]


@router.post("/conversations/{conversation_id}/messages", response_model=MessageOut)
async def send_message(
    conversation_id: str,
    body: TextMessageIn,
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MessageOut:
    limit_messages(request)
    _require_member(session, conversation_id, user)
    peer = _peer(session, conversation_id, user)
    if is_blocked(session, user.id, peer.id):
        raise HTTPException(status_code=403, detail="Cannot message this user")
    if not is_crypto_box_payload(body.encrypted_payload):
        raise HTTPException(
            status_code=400,
            detail="Internet messages must be libsodium crypto_box payloads",
        )
    now = utcnow()
    message_id = body.message_id or new_id()
    existing = session.get(Message, message_id)
    if existing:
        if existing.sender_id != user.id or existing.conversation_id != conversation_id:
            raise HTTPException(status_code=409, detail="message_id already used")
        return _message_out(existing)
    # Transport/HTTP success is SENT. Cryptographic DELIVERED is a client-decrypted
    # delivery_ack; the server cannot fabricate that from websocket presence.
    status = "SENT"
    row = Message(
        id=message_id,
        conversation_id=conversation_id,
        sender_id=user.id,
        recipient_id=peer.id,
        encrypted_payload=body.encrypted_payload,
        created_at=now,
        expires_at=now + timedelta(milliseconds=DEFAULT_TTL_MS),
        ttl=DEFAULT_TTL_MS,
        hop_count=0,
        transport="internet",
        status=status,
    )
    session.add(row)
    session.add(
        MessageDelivery(message_id=row.id, recipient_user_id=peer.id, status=status),
    )
    session.commit()
    session.refresh(row)
    event = message_event(row)
    await hub.send_json(peer.id, event)
    await hub.send_json(user.id, event)
    return _message_out(row)


@router.post("/messages/{message_id}/acks", response_model=MessageOut)
async def ack_message(
    message_id: str,
    body: AckIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MessageOut:
    """Non-cryptographic server bookkeeping. Clients must not treat this as DELIVERED."""
    status = body.status.upper()
    if status not in {"DELIVERED", "READ"}:
        raise HTTPException(status_code=400, detail="status must be DELIVERED or READ")
    row = session.get(Message, message_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Message not found")
    if row.recipient_id != user.id:
        raise HTTPException(status_code=403, detail="Only the recipient can acknowledge")
    rank = {"SENT": 0, "DELIVERED": 1, "READ": 2}
    if rank.get(status, 0) > rank.get(row.status, 0):
        row.status = status
    delivery = session.get(MessageDelivery, (message_id, user.id))
    if delivery is None:
        delivery = MessageDelivery(message_id=message_id, recipient_user_id=user.id, status=status)
        session.add(delivery)
    elif rank.get(status, 0) > rank.get(delivery.status, 0):
        delivery.status = status
    session.add(row)
    session.commit()
    session.refresh(row)
    event = {"type": "ack", "message": _message_out(row).model_dump(mode="json")}
    await hub.send_json(row.sender_id, event)
    await hub.send_json(row.recipient_id, event)
    return _message_out(row)
