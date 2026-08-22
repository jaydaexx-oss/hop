import json

from fastapi.testclient import TestClient

from app.config import MAX_REQUEST_BYTES
from tests.keys import box_pk


BOXED = json.dumps(
    {
        "v": 1,
        "alg": "crypto_box_xsalsa20poly1305",
        "sender_pk": "pk",
        "nonce": "nonce",
        "ciphertext": "ct",
    }
)


def _auth(client: TestClient, username: str) -> tuple[str, dict]:
    response = client.post("/auth/register", json={"username": username, "password": "secret123"})
    body = response.json()
    return body["token"], body["user"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_cannot_read_another_users_conversation(client: TestClient) -> None:
    token_a, _ = _auth(client, "isoaa")
    token_b, _ = _auth(client, "isobb")
    token_c, _ = _auth(client, "isocc")
    headers_a = _headers(token_a)
    convo_id = client.post("/conversations", json={"username": "isobb"}, headers=headers_a).json()["id"]
    sent = client.post(
        f"/conversations/{convo_id}/messages",
        json={"encrypted_payload": BOXED},
        headers=headers_a,
    )
    assert sent.status_code == 200

    outsider = client.get(f"/conversations/{convo_id}/messages", headers=_headers(token_c))
    assert outsider.status_code == 403
    listed = client.get("/conversations", headers=_headers(token_c))
    assert listed.status_code == 200
    assert listed.json() == []


def test_cannot_ack_message_if_not_recipient(client: TestClient) -> None:
    token_a, _ = _auth(client, "ackaa")
    token_b, _ = _auth(client, "ackbb")
    token_c, _ = _auth(client, "ackcc")
    headers_a = _headers(token_a)
    headers_b = _headers(token_b)
    convo_id = client.post("/conversations", json={"username": "ackbb"}, headers=headers_a).json()["id"]
    sent = client.post(
        f"/conversations/{convo_id}/messages",
        json={"encrypted_payload": BOXED},
        headers=headers_a,
    )
    message_id = sent.json()["message_id"]

    sender_ack = client.post(
        f"/messages/{message_id}/acks",
        json={"status": "DELIVERED"},
        headers=headers_a,
    )
    assert sender_ack.status_code == 403

    stranger_ack = client.post(
        f"/messages/{message_id}/acks",
        json={"status": "DELIVERED"},
        headers=_headers(token_c),
    )
    assert stranger_ack.status_code == 403

    recipient_ack = client.post(
        f"/messages/{message_id}/acks",
        json={"status": "DELIVERED"},
        headers=headers_b,
    )
    assert recipient_ack.status_code == 200
    assert recipient_ack.json()["status"] == "DELIVERED"


def test_oversized_payload_is_rejected(client: TestClient) -> None:
    token_a, _ = _auth(client, "sizeaa")
    _auth(client, "sizebb")
    headers = _headers(token_a)
    convo_id = client.post("/conversations", json={"username": "sizebb"}, headers=headers).json()["id"]
    too_big = "x" * 1_048_577
    sent = client.post(
        f"/conversations/{convo_id}/messages",
        json={"encrypted_payload": too_big},
        headers=headers,
    )
    assert sent.status_code == 422


def test_content_length_over_limit_is_413(client: TestClient) -> None:
    token_a, _ = _auth(client, "clenaa")
    denied = client.post(
        "/auth/login",
        content=b"{}",
        headers={
            **_headers(token_a),
            "Content-Type": "application/json",
            "Content-Length": str(MAX_REQUEST_BYTES + 1),
        },
    )
    assert denied.status_code == 413


def test_duplicate_message_id_from_other_user_is_409(client: TestClient) -> None:
    token_a, _ = _auth(client, "dupaa")
    token_b, _ = _auth(client, "dupbb")
    token_c, _ = _auth(client, "dupcc")
    headers_a = _headers(token_a)
    headers_c = _headers(token_c)
    convo_ab = client.post("/conversations", json={"username": "dupbb"}, headers=headers_a).json()["id"]
    convo_cb = client.post("/conversations", json={"username": "dupbb"}, headers=headers_c).json()["id"]
    message_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    first = client.post(
        f"/conversations/{convo_ab}/messages",
        json={"encrypted_payload": BOXED, "message_id": message_id},
        headers=headers_a,
    )
    assert first.status_code == 200
    stolen = client.post(
        f"/conversations/{convo_cb}/messages",
        json={"encrypted_payload": BOXED, "message_id": message_id},
        headers=headers_c,
    )
    assert stolen.status_code == 409
    inbox = client.get(f"/conversations/{convo_cb}/messages", headers=headers_c)
    assert inbox.json() == []


def test_identity_matching_key_put_is_idempotent(client: TestClient) -> None:
    token, _ = _auth(client, "samekey")
    headers = _headers(token)
    pk = box_pk("samekey-user")
    first = client.put("/users/me/identity", json={"public_key": pk}, headers=headers)
    second = client.put("/users/me/identity", json={"public_key": pk}, headers=headers)
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["identity_public_key"] == pk
    assert second.json()["identity_public_key"] == pk


def test_identity_different_key_is_409_server_key_locked(client: TestClient) -> None:
    token, _ = _auth(client, "locked")
    headers = _headers(token)
    pk_a = box_pk("locked-a")
    pk_b = box_pk("locked-b")
    assert client.put("/users/me/identity", json={"public_key": pk_a}, headers=headers).status_code == 200
    second = client.put("/users/me/identity", json={"public_key": pk_b}, headers=headers)
    assert second.status_code == 409
    assert "SERVER_KEY_LOCKED" in second.json()["detail"]
    me = client.get("/users/me", headers=headers)
    assert me.json()["identity_public_key"] == pk_a
