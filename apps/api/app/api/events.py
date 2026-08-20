from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, col, select

from app.avatars import build_member_out
from app.db import get_session
from app.models.tables import (
    BlockedUser,
    Conversation,
    ConversationMember,
    Event,
    EventInvite,
    EventMember,
    User,
    utcnow,
)
from app.schemas import (
    EventCreateIn,
    EventInviteIn,
    EventInviteOut,
    EventMemberOut,
    EventOut,
    MemberOut,
)
from app.security import get_current_user, validate_username
from app.ws import hub

router = APIRouter(tags=["events"])

MIN_DURATION = timedelta(minutes=1)
MAX_DURATION = timedelta(hours=24)
MAX_START_AHEAD = timedelta(days=30)
DEFAULT_DURATION = timedelta(hours=2)
MAX_MEMBERS = 32
MAX_PENDING = 32


def _naive(dt: datetime) -> datetime:
    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _normalize_name(raw: str) -> str:
    name = " ".join(raw.split()).strip()[:48]
    if not name:
        raise HTTPException(status_code=400, detail="Event name is required")
    return name


def is_blocked(session: Session, user_a: str, user_b: str) -> bool:
    return (
        session.get(BlockedUser, (user_a, user_b)) is not None
        or session.get(BlockedUser, (user_b, user_a)) is not None
    )


def event_schedule_status(event: Event, now: datetime) -> str:
    if event.ended_at is not None and event.ended_at <= now:
        return "ended"
    if event.ends_at <= now:
        return "ended"
    if event.starts_at > now:
        return "upcoming"
    return "active"


def _member_out(session: Session, user: User, role: str) -> EventMemberOut:
    base = build_member_out(session, user)
    return EventMemberOut(
        id=base.id,
        username=base.username,
        role=role,  # type: ignore[arg-type]
        identity_public_key=base.identity_public_key,
        has_avatar=base.has_avatar,
        avatar_url=base.avatar_url,
    )


def _invitee_member(session: Session, user: User) -> MemberOut:
    return build_member_out(session, user)


def _membership(session: Session, event_id: str, user_id: str) -> Optional[EventMember]:
    return session.get(EventMember, (event_id, user_id))


def _pending_invite(session: Session, event_id: str, user_id: str) -> Optional[EventInvite]:
    invite = session.get(EventInvite, (event_id, user_id))
    if invite is None or invite.status != "pending":
        return None
    return invite


def _event_or_404(session: Session, event_id: str) -> Event:
    event = session.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def _visible_to(session: Session, event: Event, user: User) -> bool:
    if _membership(session, event.id, user.id) is not None:
        return True
    if _pending_invite(session, event.id, user.id) is not None:
        return True
    if event.visibility == "discoverable" and event_schedule_status(event, utcnow()) == "active":
        return True
    return False


def _add_conversation_member(session: Session, conversation_id: str, user_id: str) -> None:
    if session.get(ConversationMember, (conversation_id, user_id)) is None:
        session.add(ConversationMember(conversation_id=conversation_id, user_id=user_id))


def _remove_conversation_member(session: Session, conversation_id: str, user_id: str) -> None:
    row = session.get(ConversationMember, (conversation_id, user_id))
    if row is not None:
        session.delete(row)


def _event_out(session: Session, event: Event, me: User) -> EventOut:
    now = utcnow()
    schedule = event_schedule_status(event, now)
    host = session.get(User, event.host_id)
    if host is None:
        raise HTTPException(status_code=404, detail="Host not found")
    members = session.exec(select(EventMember).where(EventMember.event_id == event.id)).all()
    member_outs: list[EventMemberOut] = []
    my_role: Optional[str] = None
    for row in members:
        person = session.get(User, row.user_id)
        if person is None or person.deleted_at is not None:
            continue
        member_outs.append(_member_out(session, person, row.role))
        if person.id == me.id:
            my_role = row.role
    pending_rows = session.exec(
        select(EventInvite).where(EventInvite.event_id == event.id).where(EventInvite.status == "pending")
    ).all()
    pending: list[EventInviteOut] = []
    for invite in pending_rows:
        invitee = session.get(User, invite.invitee_id)
        if invitee is None or invitee.deleted_at is not None:
            continue
        if me.id == invite.invitee_id:
            my_role = my_role or "invited"
        if me.id in {event.host_id, invite.invitee_id}:
            pending.append(
                EventInviteOut(
                    invitee=_invitee_member(session, invitee),
                    inviter_id=invite.inviter_id,
                    status="pending",
                )
            )
    if my_role is None and _pending_invite(session, event.id, me.id) is not None:
        my_role = "invited"
    row_status = "ended" if schedule == "ended" else "invited" if my_role == "invited" else schedule
    convo = session.get(Conversation, event.conversation_id)
    return EventOut(
        id=event.id,
        name=event.name,
        host=_member_out(session, host, "host"),
        starts_at=event.starts_at,
        ends_at=event.ends_at,
        visibility=event.visibility,  # type: ignore[arg-type]
        status=schedule,  # type: ignore[arg-type]
        row_status=row_status,  # type: ignore[arg-type]
        my_role=my_role,  # type: ignore[arg-type]
        participant_count=len(member_outs),
        conversation_id=event.conversation_id,
        conversation_archived=bool(convo and convo.archived_at is not None),
        members=member_outs,
        pending_invites=pending,
    )


def _create_invites(session: Session, event: Event, host: User, usernames: list[str]) -> None:
    pending_count = len(
        session.exec(
            select(EventInvite).where(EventInvite.event_id == event.id).where(EventInvite.status == "pending")
        ).all()
    )
    member_count = len(session.exec(select(EventMember).where(EventMember.event_id == event.id)).all())
    for raw in usernames:
        handle = validate_username(raw)
        if handle == host.username:
            continue
        peer = session.exec(select(User).where(User.username == handle)).first()
        if peer is None or peer.deleted_at is not None:
            raise HTTPException(status_code=404, detail=f"User not found: {handle}")
        if is_blocked(session, host.id, peer.id):
            raise HTTPException(status_code=403, detail=f"Cannot invite {handle}")
        if _membership(session, event.id, peer.id) is not None:
            continue
        existing = session.get(EventInvite, (event.id, peer.id))
        if existing is not None and existing.status == "pending":
            continue
        if pending_count >= MAX_PENDING or member_count >= MAX_MEMBERS:
            raise HTTPException(status_code=400, detail="Event is full")
        if existing is None:
            session.add(
                EventInvite(event_id=event.id, invitee_id=peer.id, inviter_id=host.id, status="pending")
            )
        else:
            existing.status = "pending"
            existing.inviter_id = host.id
            existing.responded_at = None
            session.add(existing)
        pending_count += 1


async def _notify_invite(invitee_id: str, event_id: str) -> None:
    await hub.send_json(invitee_id, {"type": "event_invite", "event_id": event_id})


@router.post("/events", response_model=EventOut)
async def create_event(
    body: EventCreateIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> EventOut:
    now = utcnow()
    starts = _naive(body.starts_at) if body.starts_at else now
    if starts > now + MAX_START_AHEAD:
        raise HTTPException(status_code=400, detail="Start time is too far in the future")
    if body.ends_at is not None:
        ends = _naive(body.ends_at)
    else:
        duration = timedelta(milliseconds=body.duration_ms) if body.duration_ms else DEFAULT_DURATION
        if duration < MIN_DURATION or duration > MAX_DURATION:
            raise HTTPException(status_code=400, detail="Event duration must be between 1 minute and 24 hours")
        ends = starts + duration
    if ends <= starts:
        raise HTTPException(status_code=400, detail="Event must end after it starts")
    if ends - starts > MAX_DURATION:
        raise HTTPException(status_code=400, detail="Event duration must be between 1 minute and 24 hours")
    convo = Conversation(kind="event")
    session.add(convo)
    session.flush()
    event = Event(
        host_id=user.id,
        name=_normalize_name(body.name),
        starts_at=starts,
        ends_at=ends,
        visibility=body.visibility,
        conversation_id=convo.id,
    )
    session.add(event)
    session.flush()
    session.add(EventMember(event_id=event.id, user_id=user.id, role="host"))
    _add_conversation_member(session, convo.id, user.id)
    _create_invites(session, event, user, body.invite_usernames)
    session.commit()
    session.refresh(event)
    for invite in session.exec(
        select(EventInvite).where(EventInvite.event_id == event.id).where(EventInvite.status == "pending")
    ).all():
        await _notify_invite(invite.invitee_id, event.id)
    return _event_out(session, event, user)


@router.get("/events", response_model=list[EventOut])
def list_events(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[EventOut]:
    member_ids = session.exec(select(EventMember.event_id).where(EventMember.user_id == user.id)).all()
    invite_ids = session.exec(
        select(EventInvite.event_id).where(EventInvite.invitee_id == user.id).where(EventInvite.status == "pending")
    ).all()
    ids = set(member_ids) | set(invite_ids)
    if not ids:
        return []
    events = session.exec(select(Event).where(col(Event.id).in_(ids))).all()
    events.sort(key=lambda item: item.starts_at, reverse=True)
    return [_event_out(session, event, user) for event in events]


@router.get("/events/discoverable", response_model=list[EventOut])
def list_discoverable_events(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[EventOut]:
    now = utcnow()
    rows = session.exec(
        select(Event).where(Event.visibility == "discoverable").where(col(Event.ended_at).is_(None))
    ).all()
    out: list[EventOut] = []
    for event in rows:
        if event_schedule_status(event, now) != "active":
            continue
        if _membership(session, event.id, user.id) is not None:
            continue
        out.append(_event_out(session, event, user))
    return out


@router.get("/events/{event_id}", response_model=EventOut)
def get_event(
    event_id: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> EventOut:
    event = _event_or_404(session, event_id)
    if not _visible_to(session, event, user):
        raise HTTPException(status_code=404, detail="Event not found")
    return _event_out(session, event, user)


@router.post("/events/{event_id}/invites", response_model=EventOut)
async def invite_people(
    event_id: str,
    body: EventInviteIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> EventOut:
    event = _event_or_404(session, event_id)
    member = _membership(session, event.id, user.id)
    if member is None or member.role != "host":
        raise HTTPException(status_code=403, detail="Only the host can invite people")
    if event_schedule_status(event, utcnow()) == "ended":
        raise HTTPException(status_code=400, detail="Event has ended")
    before = {
        row.invitee_id
        for row in session.exec(
            select(EventInvite).where(EventInvite.event_id == event.id).where(EventInvite.status == "pending")
        ).all()
    }
    _create_invites(session, event, user, body.usernames)
    session.commit()
    session.refresh(event)
    after = session.exec(
        select(EventInvite).where(EventInvite.event_id == event.id).where(EventInvite.status == "pending")
    ).all()
    for invite in after:
        if invite.invitee_id not in before:
            await _notify_invite(invite.invitee_id, event.id)
    return _event_out(session, event, user)


@router.delete("/events/{event_id}/invites/{user_id}", response_model=EventOut)
def cancel_invite(
    event_id: str,
    user_id: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> EventOut:
    event = _event_or_404(session, event_id)
    member = _membership(session, event.id, user.id)
    if member is None or member.role != "host":
        raise HTTPException(status_code=403, detail="Only the host can cancel invites")
    invite = _pending_invite(session, event.id, user_id)
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    invite.status = "cancelled"
    invite.responded_at = utcnow()
    session.add(invite)
    session.commit()
    session.refresh(event)
    return _event_out(session, event, user)


@router.post("/events/{event_id}/accept", response_model=EventOut)
def accept_invite(
    event_id: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> EventOut:
    event = _event_or_404(session, event_id)
    invite = _pending_invite(session, event.id, user.id)
    if invite is None:
        raise HTTPException(status_code=403, detail="No pending invite")
    if event_schedule_status(event, utcnow()) == "ended":
        raise HTTPException(status_code=400, detail="Event has ended")
    member_count = len(session.exec(select(EventMember).where(EventMember.event_id == event.id)).all())
    if member_count >= MAX_MEMBERS:
        raise HTTPException(status_code=400, detail="Event is full")
    invite.status = "accepted"
    invite.responded_at = utcnow()
    session.add(invite)
    if _membership(session, event.id, user.id) is None:
        session.add(EventMember(event_id=event.id, user_id=user.id, role="guest"))
    _add_conversation_member(session, event.conversation_id, user.id)
    session.commit()
    session.refresh(event)
    return _event_out(session, event, user)


@router.post("/events/{event_id}/decline", response_model=EventOut)
def decline_invite(
    event_id: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> EventOut:
    event = _event_or_404(session, event_id)
    invite = _pending_invite(session, event.id, user.id)
    if invite is None:
        raise HTTPException(status_code=403, detail="No pending invite")
    invite.status = "declined"
    invite.responded_at = utcnow()
    session.add(invite)
    session.commit()
    session.refresh(event)
    return _event_out(session, event, user)


@router.post("/events/{event_id}/join", response_model=EventOut)
def join_event(
    event_id: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> EventOut:
    event = _event_or_404(session, event_id)
    if _membership(session, event.id, user.id) is not None:
        return _event_out(session, event, user)
    invite = _pending_invite(session, event.id, user.id)
    if invite is not None:
        return accept_invite(event_id, session, user)
    if event.visibility != "discoverable" or event_schedule_status(event, utcnow()) != "active":
        raise HTTPException(status_code=403, detail="This event is invite only")
    member_count = len(session.exec(select(EventMember).where(EventMember.event_id == event.id)).all())
    if member_count >= MAX_MEMBERS:
        raise HTTPException(status_code=400, detail="Event is full")
    session.add(EventMember(event_id=event.id, user_id=user.id, role="guest"))
    _add_conversation_member(session, event.conversation_id, user.id)
    session.commit()
    session.refresh(event)
    return _event_out(session, event, user)


@router.post("/events/{event_id}/leave", response_model=EventOut)
def leave_event(
    event_id: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> EventOut:
    event = _event_or_404(session, event_id)
    member = _membership(session, event.id, user.id)
    if member is None:
        raise HTTPException(status_code=403, detail="Not a member of this event")
    if member.role == "host":
        raise HTTPException(status_code=400, detail="Host must end the event")
    session.delete(member)
    _remove_conversation_member(session, event.conversation_id, user.id)
    session.commit()
    session.refresh(event)
    return _event_out(session, event, user)


@router.delete("/events/{event_id}/members/{user_id}", response_model=EventOut)
def remove_member(
    event_id: str,
    user_id: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> EventOut:
    event = _event_or_404(session, event_id)
    actor = _membership(session, event.id, user.id)
    if actor is None or actor.role != "host":
        raise HTTPException(status_code=403, detail="Only the host can remove guests")
    target = _membership(session, event.id, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Member not found")
    if target.role == "host":
        raise HTTPException(status_code=400, detail="Cannot remove the host")
    session.delete(target)
    _remove_conversation_member(session, event.conversation_id, user_id)
    session.commit()
    session.refresh(event)
    return _event_out(session, event, user)


@router.post("/events/{event_id}/end", response_model=EventOut)
def end_event(
    event_id: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> EventOut:
    event = _event_or_404(session, event_id)
    member = _membership(session, event.id, user.id)
    if member is None or member.role != "host":
        raise HTTPException(status_code=403, detail="Only the host can end the event")
    now = utcnow()
    if event_schedule_status(event, now) == "ended":
        return _event_out(session, event, user)
    event.ended_at = now
    session.add(event)
    convo = session.get(Conversation, event.conversation_id)
    if convo is not None:
        convo.archived_at = now
        session.add(convo)
    for invite in session.exec(
        select(EventInvite).where(EventInvite.event_id == event.id).where(EventInvite.status == "pending")
    ).all():
        invite.status = "cancelled"
        invite.responded_at = now
        session.add(invite)
    session.commit()
    session.refresh(event)
    return _event_out(session, event, user)
