from __future__ import annotations

from datetime import datetime
from typing import Literal

MessageStatus = Literal[
    "CREATED",
    "ENCRYPTING",
    "ENCRYPTED",
    "QUEUED",
    "RETRYING",
    "SENDING",
    "SENT",
    "RELAYING",
    "DELIVERED",
    "READ",
    "FAILED",
    "EXPIRED",
]

ALLOWED_TRANSITIONS: dict[MessageStatus, tuple[MessageStatus, ...]] = {
    "CREATED": ("ENCRYPTING", "ENCRYPTED", "FAILED", "EXPIRED"),
    "ENCRYPTING": ("ENCRYPTED", "FAILED", "EXPIRED"),
    "ENCRYPTED": ("QUEUED", "FAILED", "EXPIRED"),
    "QUEUED": ("SENDING", "RETRYING", "FAILED", "EXPIRED"),
    "RETRYING": ("SENDING", "FAILED", "EXPIRED"),
    "SENDING": ("SENT", "QUEUED", "RETRYING", "FAILED", "EXPIRED"),
    "SENT": ("DELIVERED", "RELAYING", "FAILED", "EXPIRED"),
    "RELAYING": ("DELIVERED", "RELAYING", "FAILED", "EXPIRED"),
    "DELIVERED": ("READ",),
    "READ": (),
    "FAILED": ("QUEUED", "DELIVERED"),
    "EXPIRED": (),
}


class IllegalStateTransitionError(ValueError):
    def __init__(self, src: MessageStatus, dest: MessageStatus) -> None:
        super().__init__(f"Illegal message transition: {src} -> {dest}")
        self.src = src
        self.dest = dest


def can_transition(src: MessageStatus, dest: MessageStatus) -> bool:
    return dest in ALLOWED_TRANSITIONS[src]


def transition(src: MessageStatus, dest: MessageStatus) -> MessageStatus:
    if src == dest:
        return dest
    if not can_transition(src, dest):
        raise IllegalStateTransitionError(src, dest)
    return dest


RECEIPT_RANK = {
    "EXPIRED": -20,
    "FAILED": -10,
    "CREATED": 0,
    "ENCRYPTING": 10,
    "ENCRYPTED": 20,
    "QUEUED": 30,
    "RETRYING": 40,
    "SENDING": 50,
    "SENT": 60,
    "RELAYING": 60,
    "DELIVERED": 70,
    "READ": 80,
}


def apply_receipt_status(current: MessageStatus, incoming: MessageStatus) -> MessageStatus:
    """SENT → DELIVERED → READ never regresses. READ + delayed DELIVERED stays READ."""
    if current == incoming:
        return current
    if current == "EXPIRED":
        return current
    if current == "READ":
        return current
    if current == "DELIVERED":
        return "READ" if incoming == "READ" else "DELIVERED"
    if current == "FAILED":
        if incoming in {"QUEUED", "DELIVERED", "READ"}:
            return incoming
        return current
    if current == "SENDING" and incoming in {"QUEUED", "RETRYING"}:
        return incoming
    if incoming in {"FAILED", "EXPIRED"}:
        return incoming
    if RECEIPT_RANK.get(incoming, -100) < RECEIPT_RANK.get(current, -100):
        return current
    return incoming


def should_stop_forwarding(hop_count: int, expires_at: datetime, now: datetime, max_hops: int = 8) -> bool:
    return hop_count >= max_hops or now >= expires_at
