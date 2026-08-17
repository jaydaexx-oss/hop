import json

from fastapi.testclient import TestClient

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
    return response.json()["token"], response.json()["user"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_malformed_api_bodies_rejected(client: TestClient) -> None:
    token, _ = _auth(client, "malapi")
    assert client.post("/auth/login", json={"username": "x"}).status_code == 422
    assert client.get("/users/me").status_code == 401
    assert client.post("/conversations", json={"username": "nope"}, headers=_headers(token)).status_code in {400, 404}


def test_auth_bypass_without_token_is_401(client: TestClient) -> None:
    assert client.get("/conversations").status_code == 401
    assert client.put("/users/me/identity", json={"public_key": box_pk("bypass")}).status_code == 401


def test_cross_user_message_access_denied(client: TestClient) -> None:
    token_a, _ = _auth(client, "chaosaa")
    token_b, _ = _auth(client, "chaosbb")
    token_c, _ = _auth(client, "chaoscc")
    convo = client.post("/conversations", json={"username": "chaosbb"}, headers=_headers(token_a)).json()["id"]
    sent = client.post(
        f"/conversations/{convo}/messages",
        json={"encrypted_payload": BOXED},
        headers=_headers(token_a),
    )
    assert sent.status_code == 200
    assert client.get(f"/conversations/{convo}/messages", headers=_headers(token_c)).status_code == 403
    assert client.post(
        f"/messages/{sent.json()['message_id']}/acks",
        json={"status": "DELIVERED"},
        headers=_headers(token_c),
    ).status_code == 403
