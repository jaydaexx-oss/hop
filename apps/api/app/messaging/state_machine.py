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
    "FAILED": ("QUEUED",),
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
    if not can_transition(src, dest):
        raise IllegalStateTransitionError(src, dest)
    return dest


def should_stop_forwarding(hop_count: int, expires_at: datetime, now: datetime, max_hops: int = 8) -> bool:
    return hop_count >= max_hops or now >= expires_at
