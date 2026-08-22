from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session, col, select

from app.blocks import assert_contact_allowed, is_blocked
from app.db import get_session
from app.models.tables import NearbyBroadcast, NearbyBroadcastDelivery, User, new_id, utcnow
from app.rate_limit import limit_messages
from app.schemas import NearbyBroadcastIn, NearbyBroadcastOut
from app.security import get_current_user

router = APIRouter(prefix="/nearby", tags=["nearby"])

DEFAULT_TTL_MS = 24 * 60 * 60 * 1000


def _out(row: NearbyBroadcast) -> NearbyBroadcastOut:
    return NearbyBroadcastOut(
        id=row.id,
        author_id=row.author_id,
        display_name=row.display_name,
        body=row.body,
        created_at=row.created_at,
        expires_at=row.expires_at,
        ttl_ms=row.ttl_ms,
    )


@router.post("/broadcasts", response_model=NearbyBroadcastOut)
def post_broadcast(
    body: NearbyBroadcastIn,
    request: Request,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> NearbyBroadcastOut:
    """Public nearby post. Recipients are BLE-discovered user ids, not GPS."""
    limit_messages(request)
    now = utcnow()
    ttl_ms = body.ttl_ms or DEFAULT_TTL_MS
    row = NearbyBroadcast(
        id=body.id or new_id(),
        author_id=user.id,
        display_name=user.username,
        body=body.body.strip()[:280],
        created_at=now,
        expires_at=now + timedelta(milliseconds=ttl_ms),
        ttl_ms=ttl_ms,
    )
    session.add(row)
    seen: set[str] = set()
    for raw_id in body.nearby_user_ids:
        recipient_id = (raw_id or "").strip()
        if not recipient_id or recipient_id == user.id or recipient_id in seen:
            continue
        seen.add(recipient_id)
        peer = session.get(User, recipient_id)
        if peer is None or peer.deleted_at is not None:
            continue
        try:
            assert_contact_allowed(session, user, peer, detail="Cannot share a broadcast with this user")
        except HTTPException:
            continue
        session.add(NearbyBroadcastDelivery(broadcast_id=row.id, recipient_id=peer.id, created_at=now))
    session.commit()
    session.refresh(row)
    return _out(row)


@router.get("/broadcasts", response_model=list[NearbyBroadcastOut])
def list_broadcasts(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> list[NearbyBroadcastOut]:
    now = utcnow()
    delivered_ids = [
        row.broadcast_id
        for row in session.exec(
            select(NearbyBroadcastDelivery).where(NearbyBroadcastDelivery.recipient_id == user.id)
        ).all()
    ]
    if not delivered_ids:
        return []
    rows = session.exec(select(NearbyBroadcast).where(col(NearbyBroadcast.id).in_(delivered_ids))).all()
    visible: list[NearbyBroadcast] = []
    for row in rows:
        if row.expires_at <= now:
            continue
        if is_blocked(session, user.id, row.author_id):
            continue
        visible.append(row)
    visible.sort(key=lambda item: item.created_at, reverse=True)
    return [_out(row) for row in visible]
