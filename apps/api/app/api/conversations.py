from __future__ import annotations

from datetime import timedelta

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.avatars import build_member_out
from app.blocks import assert_contact_allowed
from app.db import get_session
from app.models.tables import (
    Conversation,
    ConversationMember,
    Device,
    Event,
    EventMember,
    Message,
    MessageDelivery,
    User,
    new_id,
    utcnow,
)
from app.payload import is_crypto_box_payload
from app.rate_limit import limit_messages
from app.schemas import AckIn, ConversationCreateIn, ConversationOut, EventMessageCopyIn, MessageOut, TextMessageIn
from app.security import get_current_user, validate_username
from app.ws import hub, message_event

router = APIRouter(tags=["conversations"])

DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000


def identity_public_key(session: Session, user_id: str) -> str:
    device = session.exec(select(Device).where(Device.user_id == user_id)).first()
    return device.identity_public_key if device and device.identity_public_key else ""


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


def _conversation_kind(convo: Conversation) -> str:
    return convo.kind if getattr(convo, "kind", None) == "event" else "direct"


def _event_for_conversation(session: Session, conversation_id: str) -> Optional[Event]:
    return session.exec(select(Event).where(Event.conversation_id == conversation_id)).first()


def _active_event_member_ids(session: Session, event: Event) -> set[str]:
    return {
        row.user_id
        for row in session.exec(select(EventMember).where(EventMember.event_id == event.id)).all()
    }


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
    if _conversation_kind(convo) == "event":
        event = _event_for_conversation(session, convo.id)
        if event is None:
            raise HTTPException(status_code=404, detail="Event not found")
        host = session.get(User, event.host_id)
        if host is None:
            raise HTTPException(status_code=404, detail="Host not found")
        members = session.exec(select(ConversationMember).where(ConversationMember.conversation_id == convo.id)).all()
        member_outs = []
        for row in members:
            person = session.get(User, row.user_id)
            if person is not None and person.deleted_at is None:
                member_outs.append(build_member_out(session, person))
        return ConversationOut(
            id=convo.id,
            created_at=convo.created_at,
            peer=build_member_out(session, host),
            kind="event",
            title=event.name,
            event_id=event.id,
            archived=convo.archived_at is not None,
            members=member_outs,
        )
    peer = _peer(session, convo.id, me)
    return ConversationOut(
        id=convo.id,
        created_at=convo.created_at,
        peer=build_member_out(session, peer),
        kind="direct",
        archived=convo.archived_at is not None,
    )


def _find_direct(session: Session, user_a: str, user_b: str) -> Optional[Conversation]:
    mine = session.exec(select(ConversationMember.conversation_id).where(ConversationMember.user_id == user_a)).all()
    if not mine:
        return None
    for convo_id in mine:
        members = session.exec(select(ConversationMember).where(ConversationMember.conversation_id == convo_id)).all()
        ids = {m.user_id for m in members}
        if ids == {user_a, user_b}:
            convo = session.get(Conversation, convo_id)
            if convo is not None and _conversation_kind(convo) == "direct":
                return convo
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
    assert_contact_allowed(session, user, peer, detail="Cannot start a conversation with this user")
    existing = _find_direct(session, user.id, peer.id)
    if existing:
        return _conversation_out(session, existing, user)
    convo = Conversation()
    session.add(convo)
    session.flush()
    session.add(ConversationMember(conversation_id=convo.id, user_id=user.id))
    session.add(ConversationMember(conversation_id=convo.id, user_id=peer.id))
    session.commit()
    session.refresh(convo)
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
        if not convo:
            continue
        try:
            out.append(_conversation_out(session, convo, user))
        except HTTPException:
            continue
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
    query = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .where(Message.expires_at > now)
        .order_by(col(Message.created_at))
    )
    convo = session.get(Conversation, conversation_id)
    if convo is not None and _conversation_kind(convo) == "event":
        query = query.where(Message.recipient_id == user.id)
    rows = session.exec(query).all()
    return [_message_out(row) for row in rows]


def _store_message(
    session: Session,
    *,
    message_id: str,
    conversation_id: str,
    sender_id: str,
    recipient_id: str,
    encrypted_payload: str,
    now,
) -> Message:
    existing = session.get(Message, message_id)
    if existing:
        if existing.sender_id != sender_id or existing.conversation_id != conversation_id:
            raise HTTPException(status_code=409, detail="message_id already used")
        return existing
    row = Message(
        id=message_id,
        conversation_id=conversation_id,
        sender_id=sender_id,
        recipient_id=recipient_id,
        encrypted_payload=encrypted_payload,
        created_at=now,
        expires_at=now + timedelta(milliseconds=DEFAULT_TTL_MS),
        ttl=DEFAULT_TTL_MS,
        hop_count=0,
        transport="internet",
        status="SENT",
    )
    session.add(row)
    session.add(MessageDelivery(message_id=row.id, recipient_user_id=recipient_id, status="SENT"))
    return row


async def _send_event_message(
    conversation_id: str,
    body: TextMessageIn,
    session: Session,
    user: User,
    convo: Conversation,
) -> MessageOut:
    if convo.archived_at is not None:
        raise HTTPException(status_code=403, detail="Event chat is archived")
    event = _event_for_conversation(session, conversation_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    member_ids = _active_event_member_ids(session, event)
    if user.id not in member_ids:
        raise HTTPException(status_code=403, detail="Not a member of this conversation")
    copies: list[EventMessageCopyIn] = list(body.copies or [])
    if not copies:
        if not body.recipient_id or not body.encrypted_payload:
            raise HTTPException(status_code=400, detail="Event chat requires a recipient and crypto_box payload")
        copies = [
            EventMessageCopyIn(
                recipient_id=body.recipient_id,
                encrypted_payload=body.encrypted_payload,
                message_id=body.message_id,
            )
        ]
    now = utcnow()
    stored: list[Message] = []
    seen_recipients: set[str] = set()
    for copy in copies:
        if copy.recipient_id == user.id:
            raise HTTPException(status_code=400, detail="Cannot send without a real recipient")
        if copy.recipient_id not in member_ids:
            raise HTTPException(status_code=403, detail="Recipient is not in this event")
        if copy.recipient_id in seen_recipients:
            continue
        seen_recipients.add(copy.recipient_id)
        recipient = session.get(User, copy.recipient_id)
        if recipient is None:
            raise HTTPException(status_code=404, detail="User not found")
        assert_contact_allowed(session, user, recipient, detail="Cannot message this user")
        if not is_crypto_box_payload(copy.encrypted_payload):
            raise HTTPException(
                status_code=400,
                detail="Internet messages must be libsodium crypto_box payloads",
            )
        stored.append(
            _store_message(
                session,
                message_id=copy.message_id or new_id(),
                conversation_id=conversation_id,
                sender_id=user.id,
                recipient_id=copy.recipient_id,
                encrypted_payload=copy.encrypted_payload,
                now=now,
            )
        )
    if not stored:
        raise HTTPException(status_code=400, detail="Cannot send without a real recipient")
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        first = stored[0]
        raced = session.get(Message, first.id)
        if raced and raced.sender_id == user.id and raced.conversation_id == conversation_id:
            return _message_out(raced)
        raise HTTPException(status_code=409, detail="message_id already used")
    for row in stored:
        session.refresh(row)
        payload = message_event(row)
        await hub.send_json(row.recipient_id, payload)
        await hub.send_json(user.id, payload)
    return _message_out(stored[0])


@router.post("/conversations/{conversation_id}/messages", response_model=MessageOut)
async def send_message(
    conversation_id: str,
    body: TextMessageIn,
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> MessageOut:
    limit_messages(request)
    convo = _require_member(session, conversation_id, user)
    if _conversation_kind(convo) == "event":
        return await _send_event_message(conversation_id, body, session, user, convo)
    peer = _peer(session, conversation_id, user)
    assert_contact_allowed(session, user, peer, detail="Cannot message this user")
    if not body.encrypted_payload or not is_crypto_box_payload(body.encrypted_payload):
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
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raced = session.get(Message, message_id)
        if raced and raced.sender_id == user.id and raced.conversation_id == conversation_id:
            return _message_out(raced)
        raise HTTPException(status_code=409, detail="message_id already used")
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
