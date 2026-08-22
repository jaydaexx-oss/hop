from __future__ import annotations

from fastapi.testclient import TestClient


def _auth(client: TestClient, username: str) -> tuple[str, str]:
    response = client.post("/auth/register", json={"username": username, "password": "secret123"})
    body = response.json()
    return body["token"], body["user"]["id"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_nearby_broadcast_appears_for_ble_scoped_peer_not_the_world(client: TestClient) -> None:
    author_token, _author_id = _auth(client, "mayaaa")
    peer_token, peer_id = _auth(client, "blakee")
    stranger_token, _stranger_id = _auth(client, "drewww")

    created = client.post(
        "/nearby/broadcasts",
        json={"body": "Coffee on the patio", "nearby_user_ids": [peer_id]},
        headers=_headers(author_token),
    )
    assert created.status_code == 200
    post = created.json()
    assert post["body"] == "Coffee on the patio"
    assert post["display_name"] == "mayaaa"
    assert "identity_public_key" not in post
    assert "latitude" not in post
    assert "encrypted_payload" not in post

    inbox = client.get("/nearby/broadcasts", headers=_headers(peer_token)).json()
    assert [row["body"] for row in inbox] == ["Coffee on the patio"]

    stranger = client.get("/nearby/broadcasts", headers=_headers(stranger_token)).json()
    assert stranger == []

    author_inbox = client.get("/nearby/broadcasts", headers=_headers(author_token)).json()
    assert [row["id"] for row in author_inbox] == [post["id"]]
    assert author_inbox[0]["body"] == "Coffee on the patio"
    assert author_inbox[0]["created_at"].endswith("Z")
    assert author_inbox[0]["expires_at"].endswith("Z")


def test_author_sees_own_broadcast_without_nearby_deliveries(client: TestClient) -> None:
    token, _ = _auth(client, "soloaa")
    created = client.post(
        "/nearby/broadcasts",
        json={"body": "Just me nearby", "nearby_user_ids": []},
        headers=_headers(token),
    )
    assert created.status_code == 200
    inbox = client.get("/nearby/broadcasts", headers=_headers(token)).json()
    assert [row["id"] for row in inbox] == [created.json()["id"]]


def test_broadcast_does_not_create_a_conversation(client: TestClient) -> None:
    author_token, _ = _auth(client, "hostbc")
    peer_token, peer_id = _auth(client, "peerbc")
    client.post(
        "/nearby/broadcasts",
        json={"body": "Anyone here?", "nearby_user_ids": [peer_id]},
        headers=_headers(author_token),
    )
    assert client.get("/conversations", headers=_headers(author_token)).json() == []
    assert client.get("/conversations", headers=_headers(peer_token)).json() == []


def test_blocked_users_do_not_receive_or_see_broadcasts(client: TestClient) -> None:
    author_token, _ = _auth(client, "blockaa")
    peer_token, peer_id = _auth(client, "blockbb")
    assert client.post("/users/me/blocks", json={"username": "blockbb"}, headers=_headers(author_token)).status_code == 200

    created = client.post(
        "/nearby/broadcasts",
        json={"body": "Should not arrive", "nearby_user_ids": [peer_id]},
        headers=_headers(author_token),
    )
    assert created.status_code == 200
    assert client.get("/nearby/broadcasts", headers=_headers(peer_token)).json() == []

    reply_convo = client.post("/conversations", json={"username": "blockaa"}, headers=_headers(peer_token))
    assert reply_convo.status_code == 403


def test_rejects_gps_and_device_fields(client: TestClient) -> None:
    token, _ = _auth(client, "nogpss")
    rejected = client.post(
        "/nearby/broadcasts",
        json={"body": "hi", "nearby_user_ids": [], "latitude": 21.3},
        headers=_headers(token),
    )
    assert rejected.status_code == 422
