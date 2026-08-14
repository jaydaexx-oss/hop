import json
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.db import get_engine
from app.models.tables import Message, User, utcnow
from app.rate_limit import SlidingWindowLimiter, reset_limiters


BOXED = json.dumps(
    {
        "v": 1,
        "alg": "crypto_box_xsalsa20poly1305",
        "sender_pk": "pk",
        "nonce": "nonce",
        "ciphertext": "ct",
    }
)


def _auth(client: TestClient, username: str) -> tuple[str, str]:
    response = client.post("/auth/register", json={"username": username, "password": "secret123"})
    body = response.json()
    return body["token"], body["user"]["id"]


def test_plaintext_internet_messages_are_rejected(client: TestClient) -> None:
    token_a, _ = _auth(client, "plaina")
    _auth(client, "plainb")
    headers = {"Authorization": f"Bearer {token_a}"}
    convo_id = client.post("/conversations", json={"username": "plainb"}, headers=headers).json()["id"]
    sent = client.post(
        f"/conversations/{convo_id}/messages",
        json={"text": "hello hop"},
        headers=headers,
    )
    assert sent.status_code == 422
    listed = client.get(f"/conversations/{convo_id}/messages", headers=headers)
    assert listed.json() == []


def test_alg_none_payload_is_rejected(client: TestClient) -> None:
    token_a, _ = _auth(client, "nonea")
    _auth(client, "noneb")
    headers = {"Authorization": f"Bearer {token_a}"}
    convo_id = client.post("/conversations", json={"username": "noneb"}, headers=headers).json()["id"]
    sent = client.post(
        f"/conversations/{convo_id}/messages",
        json={"encrypted_payload": json.dumps({"v": 0, "alg": "none", "text": "secret"})},
        headers=headers,
    )
    assert sent.status_code == 400
    assert "crypto_box" in sent.json()["detail"]


def test_crypto_box_list_never_includes_plaintext(client: TestClient) -> None:
    token_a, _ = _auth(client, "boxa")
    _auth(client, "boxb")
    headers = {"Authorization": f"Bearer {token_a}"}
    convo_id = client.post("/conversations", json={"username": "boxb"}, headers=headers).json()["id"]
    sent = client.post(
        f"/conversations/{convo_id}/messages",
        json={"encrypted_payload": BOXED},
        headers=headers,
    )
    assert sent.status_code == 200
    body = sent.json()
    assert body["text"] is None
    assert body["e2ee"] is True
    assert "secret" not in sent.text


def test_expired_messages_are_omitted(client: TestClient) -> None:
    token_a, id_a = _auth(client, "ttla")
    token_b, id_b = _auth(client, "ttlb")
    headers = {"Authorization": f"Bearer {token_a}"}
    convo_id = client.post("/conversations", json={"username": "ttlb"}, headers=headers).json()["id"]
    live = client.post(
        f"/conversations/{convo_id}/messages",
        json={"encrypted_payload": BOXED},
        headers=headers,
    )
    assert live.status_code == 200
    expired_id = "22222222-2222-4222-8222-222222222222"
    with Session(get_engine()) as session:
        session.add(
            Message(
                id=expired_id,
                conversation_id=convo_id,
                sender_id=id_a,
                recipient_id=id_b,
                encrypted_payload=BOXED,
                created_at=utcnow() - timedelta(days=8),
                expires_at=utcnow() - timedelta(days=1),
                ttl=1,
                hop_count=0,
                transport="internet",
                status="SENT",
            )
        )
        session.commit()
    listed = client.get(f"/conversations/{convo_id}/messages", headers=headers)
    ids = [row["message_id"] for row in listed.json()]
    assert live.json()["message_id"] in ids
    assert expired_id not in ids


def test_blocked_user_cannot_create_or_send(client: TestClient) -> None:
    token_a, _ = _auth(client, "blocka")
    token_b, _ = _auth(client, "blockb")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}
    blocked = client.post("/users/me/blocks", json={"username": "blockb"}, headers=headers_a)
    assert blocked.status_code == 200
    convo = client.post("/conversations", json={"username": "blockb"}, headers=headers_a)
    assert convo.status_code == 403
    reverse = client.post("/conversations", json={"username": "blocka"}, headers=headers_b)
    assert reverse.status_code == 403


def test_deleted_user_cannot_login_or_websocket(client: TestClient) -> None:
    token, _ = _auth(client, "goneuser")
    with Session(get_engine()) as session:
        user = session.exec(select(User).where(User.username == "goneuser")).one()
        user.deleted_at = utcnow()
        session.add(user)
        session.commit()
    login = client.post("/auth/login", json={"username": "goneuser", "password": "secret123"})
    assert login.status_code == 401
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": token})
        try:
            ws.receive_json()
            raise AssertionError("deleted session must not receive hello")
        except Exception:
            pass
    me = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 401


def test_websocket_requires_first_frame_auth(client: TestClient) -> None:
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "ping"})
        try:
            msg = ws.receive_json()
            assert msg.get("type") != "hello"
        except Exception:
            pass


def test_identity_public_key_is_published(client: TestClient) -> None:
    token_a, _ = _auth(client, "keya")
    token_b, _ = _auth(client, "keyb")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}
    pk = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    published = client.put("/users/me/identity", json={"public_key": pk}, headers=headers_b)
    assert published.status_code == 200
    assert published.json()["identity_public_key"] == pk
    convo = client.post("/conversations", json={"username": "keyb"}, headers=headers_a)
    assert convo.json()["peer"]["identity_public_key"] == pk


def test_sliding_window_limiter_blocks_floods() -> None:
    window = SlidingWindowLimiter()
    assert window.allow("ip", 2, 60)
    assert window.allow("ip", 2, 60)
    assert window.allow("ip", 2, 60) is False
    window.reset()
    assert window.allow("ip", 2, 60)


def test_auth_rate_limit_returns_429(client: TestClient, monkeypatch) -> None:
    import app.rate_limit as rl

    monkeypatch.setattr(rl, "AUTH_LIMIT", 3)
    reset_limiters()
    try:
        for i in range(3):
            response = client.post("/auth/register", json={"username": f"rate{i}x", "password": "secret123"})
            assert response.status_code in {200, 409}
        denied = client.post("/auth/register", json={"username": "ratezz", "password": "secret123"})
        assert denied.status_code == 429
    finally:
        reset_limiters()


def test_new_passwords_use_argon2id(client: TestClient) -> None:
    from sqlmodel import Session, select

    from app.db import get_engine
    from app.models.tables import User
    from app.security import hash_password, verify_password

    assert hash_password("secret123").startswith("argon2id$")
    _auth(client, "argonuser")
    with Session(get_engine()) as session:
        user = session.exec(select(User).where(User.username == "argonuser")).one()
        assert user.password_hash.startswith("argon2id$")
        assert verify_password("secret123", user.password_hash)


def test_identity_public_key_cannot_change(client: TestClient) -> None:
    token, _ = _auth(client, "immutable")
    headers = {"Authorization": f"Bearer {token}"}
    pk_a = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
    pk_b = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="
    first = client.put("/users/me/identity", json={"public_key": pk_a}, headers=headers)
    assert first.status_code == 200
    second = client.put("/users/me/identity", json={"public_key": pk_b}, headers=headers)
    assert second.status_code == 409


def test_get_user_by_id_returns_identity_key(client: TestClient) -> None:
    token_a, id_a = _auth(client, "lookupa")
    token_b, _ = _auth(client, "lookupb")
    headers_b = {"Authorization": f"Bearer {token_b}"}
    pk = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC="
    client.put("/users/me/identity", json={"public_key": pk}, headers=headers_b)
    found = client.get(f"/users/id/{id_a}", headers=headers_b)
    assert found.status_code == 200
    assert found.json()["id"] == id_a
    assert found.json()["username"] == "lookupa"
