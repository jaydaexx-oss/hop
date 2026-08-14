from datetime import datetime, timedelta

import pytest

from app.messaging.state_machine import (
    IllegalStateTransitionError,
    can_transition,
    should_stop_forwarding,
    transition,
)


def test_happy_path() -> None:
    status = "CREATED"
    for nxt in ("ENCRYPTED", "QUEUED", "SENDING", "SENT", "DELIVERED", "READ"):
        status = transition(status, nxt)  # type: ignore[arg-type]
    assert status == "READ"


def test_illegal_transition() -> None:
    with pytest.raises(IllegalStateTransitionError):
        transition("CREATED", "READ")


def test_retry_from_sending() -> None:
    assert can_transition("SENDING", "QUEUED")


def test_forwarding_stops() -> None:
    now = datetime.utcnow()
    assert should_stop_forwarding(8, now + timedelta(days=1), now) is True
    assert should_stop_forwarding(0, now - timedelta(seconds=1), now) is True
    assert should_stop_forwarding(0, now + timedelta(days=1), now) is False
