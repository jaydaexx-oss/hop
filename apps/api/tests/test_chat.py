from fastapi.testclient import TestClient


BOXED = {
    "v": 1,
    "alg": "crypto_box_xsalsa20poly1305",
    "sender_pk": "pk",
    "nonce": "nonce",
    "ciphertext": "ct",
}


def boxed() -> dict:
    import json

    return {"encrypted_payload": json.dumps(BOXED)}


def _auth(client: TestClient, username: str) -> tuple[str, str]:
    response = client.post("/auth/register", json={"username": username, "password": "secret123"})
    body = response.json()
    return body["token"], body["user"]["id"]


def test_one_to_one_chat_and_delivery(client: TestClient) -> None:
    token_a, id_a = _auth(client, "alex")
    token_b, id_b = _auth(client, "blake")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    convo = client.post("/conversations", json={"username": "blake"}, headers=headers_a)
    assert convo.status_code == 200
    convo_id = convo.json()["id"]
    assert convo.json()["peer"]["username"] == "blake"

    again = client.post("/conversations", json={"username": "blake"}, headers=headers_a)
    assert again.json()["id"] == convo_id

    listed = client.get("/conversations", headers=headers_a)
    assert len(listed.json()) == 1

    sent = client.post(
        f"/conversations/{convo_id}/messages",
        json=boxed(),
        headers=headers_a,
    )
    assert sent.status_code == 200
    message = sent.json()
    assert message["text"] is None
    assert message["e2ee"] is True
    assert message["status"] == "SENT"
    assert message["sender_id"] == id_a
    assert message["recipient_id"] == id_b
    assert "hello hop" not in sent.text

    inbox = client.get(f"/conversations/{convo_id}/messages", headers=headers_b)
    assert inbox.status_code == 200
    assert inbox.json()[0]["text"] is None
    assert inbox.json()[0]["e2ee"] is True

    delivered = client.post(
        f"/messages/{message['message_id']}/acks",
        json={"status": "DELIVERED"},
        headers=headers_b,
    )
    assert delivered.json()["status"] == "DELIVERED"

    read = client.post(
        f"/messages/{message['message_id']}/acks",
        json={"status": "READ"},
        headers=headers_b,
    )
    assert read.json()["status"] == "READ"


def test_websocket_delivers_in_realtime(client: TestClient) -> None:
    token_a, _ = _auth(client, "casey")
    token_b, _ = _auth(client, "drew")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    convo_id = client.post("/conversations", json={"username": "drew"}, headers=headers_a).json()["id"]

    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "auth", "token": token_b})
        hello = ws.receive_json()
        assert hello["type"] == "hello"
        sent = client.post(
            f"/conversations/{convo_id}/messages",
            json=boxed(),
            headers=headers_a,
        )
        assert sent.status_code == 200
        assert sent.json()["status"] == "DELIVERED"
        event = ws.receive_json()
        assert event["type"] == "message"
        assert event["message"]["text"] is None
        assert event["message"]["e2ee"] is True


def test_cannot_message_without_auth(client: TestClient) -> None:
    response = client.post("/conversations", json={"username": "anyone"})
    assert response.status_code == 401


def test_client_message_id_is_idempotent(client: TestClient) -> None:
    token_a, _ = _auth(client, "erin")
    _auth(client, "fin")
    headers_a = {"Authorization": f"Bearer {token_a}"}
    convo_id = client.post("/conversations", json={"username": "fin"}, headers=headers_a).json()["id"]
    message_id = "11111111-1111-4111-8111-111111111111"

    first = client.post(
        f"/conversations/{convo_id}/messages",
        json={**boxed(), "message_id": message_id},
        headers=headers_a,
    )
    second = client.post(
        f"/conversations/{convo_id}/messages",
        json={**boxed(), "message_id": message_id},
        headers=headers_a,
    )
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["message_id"] == message_id
    assert second.json()["message_id"] == message_id

    inbox = client.get(f"/conversations/{convo_id}/messages", headers=headers_a)
    assert len(inbox.json()) == 1
