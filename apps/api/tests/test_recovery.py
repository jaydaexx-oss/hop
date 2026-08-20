from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.db import get_engine
from app.models.tables import Device, User
from tests.keys import box_pk


def _device_secret() -> str:
    return "recover-device-secret-value-32ok"


def test_taken_handle_cannot_be_claimed_without_recovery(client: TestClient) -> None:
    registered = client.post("/auth/register", json={"username": "jaydae", "password": "secret123"})
    assert registered.status_code == 200
    original_id = registered.json()["user"]["id"]

    taken = client.get("/auth/handle-available", params={"username": "Jaydae"})
    assert taken.status_code == 200
    assert taken.json()["available"] is False
    assert "id" not in taken.json()

    denied = client.post(
        "/auth/register-device",
        json={"username": "jaydae", "public_key": box_pk("hijack"), "device_secret": "h" * 32},
    )
    assert denied.status_code == 409
    assert denied.json().get("user") is None or "id" not in denied.json().get("user", {})

    still = client.get("/users/me", headers={"Authorization": f"Bearer {registered.json()['token']}"})
    assert still.json()["id"] == original_id
    assert still.json()["username"] == "jaydae"


def test_recovery_options_are_lookup_not_auth(client: TestClient) -> None:
    client.post("/auth/register", json={"username": "legacyhop", "password": "secret123"})
    options = client.get("/auth/recovery-options", params={"username": "LegacyHop"})
    assert options.status_code == 200
    body = options.json()
    assert body["available"] is False
    assert body["legacy_password"] is True
    assert body["passkey_enrolled"] is False
    assert "id" not in body
    assert "token" not in body

    open_handle = client.get("/auth/recovery-options", params={"username": "freshrecover"})
    assert open_handle.json()["available"] is True
    assert open_handle.json()["legacy_password"] is False


def test_recover_password_restores_same_user_id_and_bind_does_not_rotate_keys(client: TestClient) -> None:
    registered = client.post("/auth/register", json={"username": "recoverada", "password": "secret123"})
    token = registered.json()["token"]
    user_id = registered.json()["user"]["id"]
    pk = box_pk("ada-id")
    assert client.put("/users/me/identity", json={"public_key": pk}, headers={"Authorization": f"Bearer {token}"}).status_code == 200

    recovered = client.post("/auth/recover/password", json={"username": "RecoverAda", "password": "secret123"})
    assert recovered.status_code == 200
    assert recovered.json()["user"]["id"] == user_id
    assert recovered.json()["user"]["identity_public_key"] == pk
    assert recovered.json()["needs_passkey_enrollment"] is True
    rec_token = recovered.json()["token"]

    bound = client.post(
        "/auth/recover/bind-device",
        json={"device_secret": "recover-bind-device-secret-32ok!"},
        headers={"Authorization": f"Bearer {rec_token}"},
    )
    assert bound.status_code == 200
    assert bound.json()["user"]["id"] == user_id
    assert bound.json()["user"]["identity_public_key"] == pk

    again = client.post("/auth/device", json={"device_secret": "recover-bind-device-secret-32ok!"})
    assert again.status_code == 200
    assert again.json()["user"]["id"] == user_id
    assert again.json()["user"]["identity_public_key"] == pk

    with Session(get_engine()) as session:
        users = session.exec(select(User).where(User.username == "recoverada")).all()
        assert len(users) == 1
        devices = session.exec(select(Device).where(Device.user_id == user_id)).all()
        assert len(devices) >= 2
        assert all(row.identity_public_key == pk for row in devices if row.identity_public_key)


def test_failed_recovery_does_not_register(client: TestClient) -> None:
    client.post("/auth/register", json={"username": "kept", "password": "secret123"})
    denied = client.post("/auth/recover/password", json={"username": "kept", "password": "wrongpass"})
    assert denied.status_code == 401
    stolen = client.post(
        "/auth/register-device",
        json={"username": "kept", "public_key": box_pk("nope"), "device_secret": "n" * 32},
    )
    assert stolen.status_code == 409
    available = client.get("/auth/handle-available", params={"username": "brandnewhop"})
    assert available.json()["available"] is True


def test_bind_device_requires_authenticated_recovery_session(client: TestClient) -> None:
    denied = client.post("/auth/recover/bind-device", json={"device_secret": "z" * 32})
    assert denied.status_code == 401


def test_passkey_register_requires_session_and_garbage_complete_fails(client: TestClient) -> None:
    token = client.post("/auth/register", json={"username": "passkeyu", "password": "secret123"}).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    begin = client.post("/auth/passkey/register/begin", headers=headers)
    assert begin.status_code == 200
    assert begin.json()["challenge_id"]
    assert begin.json()["options"]["challenge"]
    assert begin.json()["options"]["rp"]["name"] == "HOP"

    unauth = client.post("/auth/passkey/register/begin")
    assert unauth.status_code == 401

    complete = client.post(
        "/auth/passkey/register/complete",
        headers=headers,
        json={"challenge_id": begin.json()["challenge_id"], "credential": {"id": "nope", "rawId": "nope", "type": "public-key", "response": {}}},
    )
    assert complete.status_code == 400

    missing = client.post("/auth/passkey/authenticate/begin", json={"username": "passkeyu"})
    assert missing.status_code == 404


def test_identity_wrap_rejects_plaintext_secret(client: TestClient) -> None:
    token = client.post("/auth/register", json={"username": "wrapu", "password": "secret123"}).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    denied = client.put(
        "/users/me/identity-wrap",
        headers=headers,
        json={"wrapped_blob": '{"publicKey":"pk","secretKey":"super-secret-value"}'},
    )
    assert denied.status_code == 400

    stored = client.put(
        "/users/me/identity-wrap",
        headers=headers,
        json={"wrapped_blob": '{"v":1,"alg":"crypto_box_xsalsa20poly1305","epk":"AAAA","nonce":"BBBB","ciphertext":"CCCC-not-a-secret"}'},
    )
    assert stored.status_code == 200
    got = client.get("/users/me/identity-wrap", headers=headers)
    assert got.status_code == 200
    assert "secretKey" not in got.json()["wrapped_blob"]


def test_new_device_handle_still_registers(client: TestClient) -> None:
    created = client.post(
        "/auth/register-device",
        json={"username": "newhopper", "public_key": box_pk("new-hop"), "device_secret": _device_secret()},
    )
    assert created.status_code == 200
    assert created.json()["user"]["username"] == "newhopper"
    assert created.json()["user"]["identity_public_key"] == box_pk("new-hop")

    options = client.get("/auth/recovery-options", params={"username": "newhopper"})
    assert options.json()["available"] is False
    assert options.json()["legacy_password"] is False
    assert options.json()["passkey_enrolled"] is False

    denied = client.post("/auth/recover/password", json={"username": "newhopper", "password": "secret123"})
    assert denied.status_code == 401


def test_aasa_requires_apple_team_id(client: TestClient, monkeypatch) -> None:
    from app.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "apple_team_id", "")
    missing = client.get("/.well-known/apple-app-site-association")
    assert missing.status_code == 404

    monkeypatch.setattr(settings, "apple_team_id", "TEAMID1234")
    present = client.get("/.well-known/apple-app-site-association")
    assert present.status_code == 200
    assert present.json()["webcredentials"]["apps"] == ["TEAMID1234.app.hop.mobile"]
