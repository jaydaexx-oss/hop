from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi.testclient import TestClient


BOXED = {
    "v": 1,
    "alg": "crypto_box_xsalsa20poly1305",
    "sender_pk": "pk",
    "nonce": "nonce",
    "ciphertext": "ct",
}


def boxed(recipient_id: Optional[str] = None, message_id: Optional[str] = None) -> dict:
    import json

    body: dict = {"encrypted_payload": json.dumps(BOXED)}
    if recipient_id:
        body["recipient_id"] = recipient_id
    if message_id:
        body["message_id"] = message_id
    return body


def copies(*recipient_ids: str) -> dict:
    import json
    import uuid

    payload = json.dumps(BOXED)
    return {
        "copies": [
            {"recipient_id": rid, "encrypted_payload": payload, "message_id": str(uuid.uuid4())}
            for rid in recipient_ids
        ]
    }


def _auth(client: TestClient, username: str) -> tuple[str, str]:
    response = client.post("/auth/register", json={"username": username, "password": "secret123"})
    body = response.json()
    return body["token"], body["user"]["id"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_create_event_persists_and_does_not_auto_add_people(client: TestClient) -> None:
    host_token, host_id = _auth(client, "hostaa")
    guest_token, guest_id = _auth(client, "guestaa")
    _auth(client, "stranger")
    created = client.post(
        "/events",
        json={"name": "Campus mixer", "duration_ms": 3_600_000, "visibility": "invite_only"},
        headers=_headers(host_token),
    )
    assert created.status_code == 200
    event = created.json()
    assert event["name"] == "Campus mixer"
    assert event["host"]["id"] == host_id
    assert event["status"] in {"active", "upcoming"}
    assert event["participant_count"] == 1
    assert event["members"][0]["role"] == "host"
    assert event["pending_invites"] == []

    listed = client.get("/events", headers=_headers(guest_token))
    assert listed.json() == []
    missing = client.get(f"/events/{event['id']}", headers=_headers(guest_token))
    assert missing.status_code == 404


def test_invite_accept_decline_and_event_chat_archive(client: TestClient) -> None:
    host_token, host_id = _auth(client, "hostbb")
    guest_token, guest_id = _auth(client, "guestbb")
    other_token, other_id = _auth(client, "otherbb")
    created = client.post(
        "/events",
        json={
            "name": "Study hall",
            "duration_ms": 7_200_000,
            "visibility": "invite_only",
            "invite_usernames": ["guestbb", "otherbb"],
        },
        headers=_headers(host_token),
    )
    assert created.status_code == 200
    event_id = created.json()["id"]
    convo_id = created.json()["conversation_id"]
    assert created.json()["pending_invites"]
    invited = client.get("/events", headers=_headers(guest_token)).json()
    assert invited[0]["row_status"] == "invited"
    assert invited[0]["id"] == event_id

    declined = client.post(f"/events/{event_id}/decline", headers=_headers(other_token))
    assert declined.status_code == 200
    assert declined.json()["my_role"] is None or declined.json()["my_role"] != "guest"

    accepted = client.post(f"/events/{event_id}/accept", headers=_headers(guest_token))
    assert accepted.status_code == 200
    assert accepted.json()["my_role"] == "guest"
    assert accepted.json()["participant_count"] == 2

    sent = client.post(
        f"/conversations/{convo_id}/messages",
        json=copies(guest_id),
        headers=_headers(host_token),
    )
    assert sent.status_code == 200
    assert sent.json()["text"] is None
    assert sent.json()["e2ee"] is True
    assert sent.json()["recipient_id"] == guest_id

    guest_inbox = client.get(f"/conversations/{convo_id}/messages", headers=_headers(guest_token))
    assert len(guest_inbox.json()) == 1
    host_inbox = client.get(f"/conversations/{convo_id}/messages", headers=_headers(host_token))
    assert host_inbox.json() == []

    convos = client.get("/conversations", headers=_headers(guest_token)).json()
    event_chats = [row for row in convos if row.get("kind") == "event"]
    directs = [row for row in convos if row.get("kind") == "direct"]
    assert len(event_chats) == 1
    assert event_chats[0]["title"] == "Study hall"
    assert event_chats[0]["event_id"] == event_id
    assert directs == []

    ended = client.post(f"/events/{event_id}/end", headers=_headers(host_token))
    assert ended.status_code == 200
    assert ended.json()["status"] == "ended"
    assert ended.json()["conversation_archived"] is True
    blocked = client.post(
        f"/conversations/{convo_id}/messages",
        json=copies(guest_id),
        headers=_headers(host_token),
    )
    assert blocked.status_code == 403
    still_there = client.get(f"/conversations/{convo_id}/messages", headers=_headers(guest_token))
    assert len(still_there.json()) == 1


def test_leave_and_remove_lose_future_event_chat(client: TestClient) -> None:
    host_token, _ = _auth(client, "hostcc")
    guest_token, guest_id = _auth(client, "guestcc")
    extra_token, extra_id = _auth(client, "extracc")
    event_id = client.post(
        "/events",
        json={"name": "Mixer", "invite_usernames": ["guestcc", "extracc"]},
        headers=_headers(host_token),
    ).json()["id"]
    convo_id = client.get(f"/events/{event_id}", headers=_headers(host_token)).json()["conversation_id"]
    client.post(f"/events/{event_id}/accept", headers=_headers(guest_token))
    client.post(f"/events/{event_id}/accept", headers=_headers(extra_token))

    removed = client.delete(f"/events/{event_id}/members/{guest_id}", headers=_headers(host_token))
    assert removed.status_code == 200
    assert all(member["id"] != guest_id for member in removed.json()["members"])
    denied = client.get(f"/conversations/{convo_id}/messages", headers=_headers(guest_token))
    assert denied.status_code == 403
    cannot_send = client.post(
        f"/conversations/{convo_id}/messages",
        json=copies(extra_id),
        headers=_headers(guest_token),
    )
    assert cannot_send.status_code == 403

    left = client.post(f"/events/{event_id}/leave", headers=_headers(extra_token))
    assert left.status_code == 200
    extra_denied = client.get(f"/conversations/{convo_id}/messages", headers=_headers(extra_token))
    assert extra_denied.status_code == 403

    guest_remove = client.delete(f"/events/{event_id}/members/{guest_id}", headers=_headers(guest_token))
    assert guest_remove.status_code == 403


def test_discoverable_is_not_auto_join(client: TestClient) -> None:
    host_token, _ = _auth(client, "hostdd")
    nearby_token, _ = _auth(client, "neardd")
    event = client.post(
        "/events",
        json={"name": "Open yard", "visibility": "discoverable"},
        headers=_headers(host_token),
    ).json()
    found = client.get("/events/discoverable", headers=_headers(nearby_token)).json()
    assert any(item["id"] == event["id"] for item in found)
    listed = client.get("/events", headers=_headers(nearby_token)).json()
    assert listed == []
    joined = client.post(f"/events/{event['id']}/join", headers=_headers(nearby_token))
    assert joined.status_code == 200
    assert joined.json()["my_role"] == "guest"


def test_direct_chat_still_requires_exactly_two_members(client: TestClient) -> None:
    token_a, _ = _auth(client, "directa")
    _auth(client, "directb")
    convo = client.post("/conversations", json={"username": "directb"}, headers=_headers(token_a))
    assert convo.status_code == 200
    assert convo.json()["kind"] == "direct"
    assert convo.json()["peer"]["username"] == "directb"


def test_upcoming_event_uses_start_time(client: TestClient) -> None:
    host_token, _ = _auth(client, "hostee")
    starts = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    created = client.post(
        "/events",
        json={"name": "Later", "starts_at": starts, "duration_ms": 3_600_000},
        headers=_headers(host_token),
    )
    assert created.status_code == 200
    assert created.json()["status"] == "upcoming"
    assert created.json()["row_status"] == "upcoming"
