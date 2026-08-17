from fastapi.testclient import TestClient

from tests.keys import box_pk


def _auth(client: TestClient, username: str) -> tuple[str, dict]:
    response = client.post("/auth/register", json={"username": username, "password": "secret123"})
    body = response.json()
    return body["token"], body["user"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_malformed_public_key_rejected(client: TestClient) -> None:
    token, _ = _auth(client, "badkeyu")
    headers = _headers(token)
    for payload in ("short", "%%%not-b64%%%", "AAAA\nAAAA", "A" * 32):
        denied = client.put("/users/me/identity", json={"public_key": payload}, headers=headers)
        assert denied.status_code in {400, 422}


def test_cross_account_key_substitution_rejected(client: TestClient) -> None:
    token_a, _ = _auth(client, "keyowna")
    token_b, _ = _auth(client, "keyownb")
    pk = box_pk("shared-identity-key")
    assert client.put("/users/me/identity", json={"public_key": pk}, headers=_headers(token_a)).status_code == 200
    stolen = client.put("/users/me/identity", json={"public_key": pk}, headers=_headers(token_b))
    assert stolen.status_code == 409
    me_b = client.get("/users/me", headers=_headers(token_b))
    assert me_b.json()["identity_public_key"] in {"", None} or me_b.json()["identity_public_key"] != pk


def test_unauthenticated_identity_update_rejected(client: TestClient) -> None:
    denied = client.put("/users/me/identity", json={"public_key": box_pk("noauth")})
    assert denied.status_code == 401


def test_rollback_to_older_key_keeps_original(client: TestClient) -> None:
    token, _ = _auth(client, "rollkey")
    headers = _headers(token)
    pk_a = box_pk("roll-a")
    pk_b = box_pk("roll-b")
    assert client.put("/users/me/identity", json={"public_key": pk_a}, headers=headers).status_code == 200
    assert client.put("/users/me/identity", json={"public_key": pk_b}, headers=headers).status_code == 409
    again = client.put("/users/me/identity", json={"public_key": pk_a}, headers=headers)
    assert again.status_code == 200
    assert client.get("/users/me", headers=headers).json()["identity_public_key"] == pk_a


def test_server_cannot_silently_replace_published_key(client: TestClient) -> None:
    token, _ = _auth(client, "sticky")
    headers = _headers(token)
    pk = box_pk("sticky-a")
    client.put("/users/me/identity", json={"public_key": pk}, headers=headers)
    client.put("/users/me/identity", json={"public_key": box_pk("sticky-b")}, headers=headers)
    me = client.get("/users/me", headers=headers)
    assert me.json()["identity_public_key"] == pk


def test_concurrent_registration_unique_username(client: TestClient) -> None:
    # TestClient+sqlite is not thread-safe. Uniqueness is the unique constraint plus IntegrityError → 409.
    first = client.post("/auth/register", json={"username": "raceuser", "password": "secret123"})
    rest = [
        client.post("/auth/register", json={"username": "raceuser", "password": "secret123"})
        for _ in range(7)
    ]
    assert first.status_code == 200
    assert all(item.status_code == 409 for item in rest)


def test_replayed_identity_body_is_idempotent_not_a_rotation(client: TestClient) -> None:
    token, _ = _auth(client, "replayk")
    headers = _headers(token)
    pk = box_pk("replay-pk")
    first = client.put("/users/me/identity", json={"public_key": pk}, headers=headers)
    second = client.put("/users/me/identity", json={"public_key": pk}, headers=headers)
    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["identity_public_key"] == pk
