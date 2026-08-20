from __future__ import annotations

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.db import get_engine
from app.models.tables import BlockInstallCooldown, BlockedUser
from app.rate_limit import reset_limiters
from app.security import hash_token
from tests.keys import box_pk

BOXED = (
    '{"v":1,"alg":"crypto_box_xsalsa20poly1305","sender_pk":"pk","nonce":"nonce","ciphertext":"ct"}'
)


def _password_auth(client: TestClient, username: str) -> tuple[str, str]:
    response = client.post("/auth/register", json={"username": username, "password": "secret123"})
    body = response.json()
    return body["token"], body["user"]["id"]


def _device_auth(
    client: TestClient,
    username: str,
    label: str,
    *,
    install: str | None = "a" * 64,
    secret: str | None = None,
) -> tuple[str, str]:
    payload = {
        "username": username,
        "public_key": box_pk(label),
        "device_secret": secret or (label + "x" * 32)[:32],
    }
    headers = {"X-Hop-Install": install} if install else {}
    response = client.post("/auth/register-device", json=payload, headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    return body["token"], body["user"]["id"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_blocks_are_stored_by_user_id_not_handle(client: TestClient) -> None:
    token_a, id_a = _password_auth(client, "blockid1")
    token_b, id_b = _password_auth(client, "blockid2")
    blocked = client.post("/users/me/blocks", json={"username": "blockid2"}, headers=_headers(token_a))
    assert blocked.status_code == 200
    listed = client.get("/users/me/blocks", headers=_headers(token_a))
    assert listed.status_code == 200
    body = listed.json()
    assert body["usernames"] == ["blockid2"]
    assert body["user_ids"] == [id_b]
    with Session(get_engine()) as session:
        row = session.get(BlockedUser, (id_a, id_b))
        assert row is not None
        assert row.user_id == id_a
        assert row.blocked_user_id == id_b


def test_handle_change_does_not_unblock(client: TestClient) -> None:
    token_a, _ = _password_auth(client, "keepblock")
    token_b, id_b = _password_auth(client, "oldhandle")
    assert client.post("/users/me/blocks", json={"username": "oldhandle"}, headers=_headers(token_a)).status_code == 200
    changed = client.put("/users/me/handle", json={"username": "newhandle"}, headers=_headers(token_b))
    assert changed.status_code == 200
    assert changed.json()["id"] == id_b
    listed = client.get("/users/me/blocks", headers=_headers(token_a))
    assert "newhandle" in listed.json()["usernames"]
    assert id_b in listed.json()["user_ids"]
    denied = client.post("/conversations", json={"username": "newhandle"}, headers=_headers(token_a))
    assert denied.status_code == 403
    reverse = client.post("/conversations", json={"username": "keepblock"}, headers=_headers(token_b))
    assert reverse.status_code == 403


def test_logout_and_local_reset_do_not_delete_server_blocks(client: TestClient) -> None:
    token_a, id_a = _password_auth(client, "stayblock")
    token_b, id_b = _password_auth(client, "resetpeer")
    assert client.post("/users/me/blocks", json={"username": "resetpeer"}, headers=_headers(token_a)).status_code == 200
    logout = client.post("/auth/logout", headers=_headers(token_b))
    assert logout.status_code == 200
    with Session(get_engine()) as session:
        assert session.get(BlockedUser, (id_a, id_b)) is not None
        assert session.exec(select(BlockedUser).where(BlockedUser.user_id == id_b)).all() == []
    still = client.post("/conversations", json={"username": "resetpeer"}, headers=_headers(token_a))
    assert still.status_code == 403


def test_blocked_cannot_message_invite_or_join(client: TestClient) -> None:
    token_a, _id_a = _password_auth(client, "hostblock")
    token_b, _id_b = _password_auth(client, "guestblock")
    token_c, _id_c = _password_auth(client, "otherblock")
    assert client.post("/users/me/blocks", json={"username": "guestblock"}, headers=_headers(token_a)).status_code == 200

    dm = client.post("/conversations", json={"username": "hostblock"}, headers=_headers(token_b))
    assert dm.status_code == 403

    created = client.post(
        "/events",
        json={"name": "Blocked mixer", "invite_usernames": ["guestblock"]},
        headers=_headers(token_a),
    )
    assert created.status_code == 403

    open_event = client.post(
        "/events",
        json={"name": "Open mixer", "visibility": "discoverable"},
        headers=_headers(token_a),
    )
    assert open_event.status_code == 200
    later = client.post(
        f"/events/{open_event.json()['id']}/invites",
        json={"usernames": ["guestblock"]},
        headers=_headers(token_a),
    )
    assert later.status_code == 403
    join = client.post(f"/events/{open_event.json()['id']}/join", headers=_headers(token_b))
    assert join.status_code == 403

    ok_event = client.post(
        "/events",
        json={"name": "Allowed mixer", "invite_usernames": ["otherblock"]},
        headers=_headers(token_a),
    )
    assert ok_event.status_code == 200
    convo_id = client.post("/conversations", json={"username": "otherblock"}, headers=_headers(token_a)).json()["id"]
    sent = client.post(
        f"/conversations/{convo_id}/messages",
        json={"encrypted_payload": BOXED},
        headers=_headers(token_a),
    )
    assert sent.status_code == 200


def test_block_by_user_id_survives_handle_and_blocks_event_chat(client: TestClient) -> None:
    token_a, _ = _password_auth(client, "idhost")
    token_b, id_b = _password_auth(client, "idguest")
    created = client.post(
        "/events",
        json={"name": "Study", "invite_usernames": ["idguest"]},
        headers=_headers(token_a),
    )
    assert created.status_code == 200
    event_id = created.json()["id"]
    convo_id = created.json()["conversation_id"]
    assert client.post(f"/events/{event_id}/accept", headers=_headers(token_b)).status_code == 200
    assert client.post("/users/me/blocks", json={"username": "idguest", "user_id": id_b}, headers=_headers(token_a)).status_code == 200
    reply = client.post(
        f"/conversations/{convo_id}/messages",
        json={
            "copies": [
                {"recipient_id": created.json()["host"]["id"], "encrypted_payload": BOXED, "message_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}
            ]
        },
        headers=_headers(token_b),
    )
    assert reply.status_code == 403


def test_register_device_rate_limit_by_install_and_ip(client: TestClient, monkeypatch) -> None:
    import app.rate_limit as rl

    monkeypatch.setattr(rl, "REGISTER_DEVICE_LIMIT", 2)
    monkeypatch.setattr(rl, "REGISTER_DEVICE_IP_LIMIT", 10)
    reset_limiters()
    try:
        install = "b" * 64
        first = client.post(
            "/auth/register-device",
            json={"username": "rateone", "public_key": box_pk("rate-1"), "device_secret": "1" * 32},
            headers={"X-Hop-Install": install},
        )
        assert first.status_code == 200
        second = client.post(
            "/auth/register-device",
            json={"username": "ratetwo", "public_key": box_pk("rate-2"), "device_secret": "2" * 32},
            headers={"X-Hop-Install": install},
        )
        assert second.status_code == 200
        denied = client.post(
            "/auth/register-device",
            json={"username": "ratethree", "public_key": box_pk("rate-3"), "device_secret": "3" * 32},
            headers={"X-Hop-Install": install},
        )
        assert denied.status_code == 429
        reuse = client.post(
            "/auth/register-device",
            json={"username": "rateone", "public_key": box_pk("rate-1"), "device_secret": "1" * 32},
            headers={"X-Hop-Install": install},
        )
        assert reuse.status_code == 200
    finally:
        reset_limiters()


def test_new_account_same_install_cannot_contact_blocker(client: TestClient) -> None:
    install = "c" * 64
    token_a, id_a = _password_auth(client, "victimax")
    token_b, id_b = _device_auth(client, "evadeb", "evade-b", install=install)
    assert client.post("/users/me/blocks", json={"username": "evadeb"}, headers=_headers(token_a)).status_code == 200
    with Session(get_engine()) as session:
        assert session.get(BlockedUser, (id_a, id_b)) is not None
        cooldown = session.get(BlockInstallCooldown, (id_a, hash_token(install)))
        assert cooldown is not None
        assert cooldown.blocked_user_id == id_b
    token_c, _id_c = _device_auth(client, "evadec", "evade-c", install=install)
    denied = client.post("/conversations", json={"username": "victimax"}, headers=_headers(token_c))
    assert denied.status_code == 403
    invite = client.post(
        "/events",
        json={"name": "Evade mixer", "invite_usernames": ["victimax"]},
        headers=_headers(token_c),
    )
    assert invite.status_code == 403
    with Session(get_engine()) as session:
        remaining = session.exec(select(BlockedUser).where(BlockedUser.blocked_user_id == id_b)).all()
        assert remaining
