from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.db import get_session, postgres_engine_options
from app.main import app


def test_register_login_me_logout(client: TestClient) -> None:
    registered = client.post("/auth/register", json={"username": "Ada", "password": "secret123"})
    assert registered.status_code == 200
    body = registered.json()
    assert body["user"]["username"] == "ada"
    token = body["token"]

    me = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["username"] == "ada"

    login = client.post("/auth/login", json={"username": "ada", "password": "secret123"})
    assert login.status_code == 200
    token2 = login.json()["token"]

    logged_out = client.post("/auth/logout", headers={"Authorization": f"Bearer {token2}"})
    assert logged_out.status_code == 200
    denied = client.get("/users/me", headers={"Authorization": f"Bearer {token2}"})
    assert denied.status_code == 401


def test_duplicate_username(client: TestClient) -> None:
    client.post("/auth/register", json={"username": "sam", "password": "secret123"})
    again = client.post("/auth/register", json={"username": "Sam", "password": "secret123"})
    assert again.status_code == 409


def test_bad_login(client: TestClient) -> None:
    client.post("/auth/register", json={"username": "jordan", "password": "secret123"})
    response = client.post("/auth/login", json={"username": "jordan", "password": "wrongpass"})
    assert response.status_code == 401


def test_register_invalid_username_is_400(client: TestClient) -> None:
    too_short = client.post("/auth/register", json={"username": "ab", "password": "secret123"})
    assert too_short.status_code == 400
    starts_with_digit = client.post("/auth/register", json={"username": "1abc", "password": "secret123"})
    assert starts_with_digit.status_code == 400


def test_register_short_password_is_422(client: TestClient) -> None:
    response = client.post("/auth/register", json={"username": "goodname", "password": "short"})
    assert response.status_code == 422


def test_register_stale_db_connection_returns_503_not_500(client: TestClient) -> None:
    """Fly: POST /auth/register 500 on SELECT users when Postgres closed the idle connection."""

    class DeadSession:
        def exec(self, *_args, **_kwargs):
            raise OperationalError(
                "SELECT users.id, users.username, users.password_hash, users.created_at, users.deleted_at FROM users WHERE users.username = %(username_1)s::VARCHAR",
                {"username_1": "jaydae10"},
                Exception("server closed the connection unexpectedly"),
            )

        def rollback(self) -> None:
            return None

    def override_session():
        yield DeadSession()

    app.dependency_overrides[get_session] = override_session
    try:
        response = client.post("/auth/register", json={"username": "jaydae10", "password": "secret123"})
    finally:
        app.dependency_overrides.pop(get_session, None)
    assert response.status_code == 503
    body = response.json()
    assert body["detail"] == "Service temporarily unavailable"
    assert "Internal server error" not in response.text
    assert "traceback" not in response.text.lower()
    assert "password_hash" not in response.text
    assert "closed the connection" not in response.text


def test_postgres_engine_pre_pings_stale_connections(monkeypatch) -> None:
    from app.config import get_settings
    from app import db

    seen: dict[str, object] = {}

    def fake_create_engine(url: str, **kwargs: object) -> object:
        seen["sqlite"] = str(url).startswith("sqlite")
        seen["kwargs"] = kwargs
        return object()

    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://hop:unused@127.0.0.1:5432/hop")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setattr(db, "create_engine", fake_create_engine)
    get_settings.cache_clear()
    db.get_engine.cache_clear()
    try:
        options = postgres_engine_options()
        assert options["pool_pre_ping"] is True
        assert options["pool_recycle"] == 300
        db.get_engine()
        assert seen["sqlite"] is False
        assert seen["kwargs"] == options
    finally:
        db.get_engine.cache_clear()
        get_settings.cache_clear()


def _device_secret() -> str:
    return "d" * 32


def test_register_device_returns_existing_token_shape(client: TestClient) -> None:
    from tests.keys import box_pk

    pk = box_pk("device-ada")
    registered = client.post(
        "/auth/register-device",
        json={"username": "AdaDevice", "public_key": pk, "device_secret": _device_secret()},
    )
    assert registered.status_code == 200
    body = registered.json()
    assert "token" in body and body["token"]
    assert body["user"]["username"] == "adadevice"
    assert body["user"]["id"]
    assert body["user"]["identity_public_key"] == pk

    me = client.get("/users/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.status_code == 200
    assert me.json()["id"] == body["user"]["id"]
    assert me.json()["identity_public_key"] == pk


def test_register_device_retry_keeps_same_user_id(client: TestClient) -> None:
    from tests.keys import box_pk

    pk = box_pk("device-retry")
    secret = "r" * 32
    first = client.post(
        "/auth/register-device",
        json={"username": "retrydev", "public_key": pk, "device_secret": secret},
    )
    assert first.status_code == 200
    user_id = first.json()["user"]["id"]
    second = client.post(
        "/auth/register-device",
        json={"username": "retrydev", "public_key": pk, "device_secret": secret},
    )
    assert second.status_code == 200
    assert second.json()["user"]["id"] == user_id
    assert second.json()["user"]["identity_public_key"] == pk


def test_register_device_rejects_duplicate_handle(client: TestClient) -> None:
    from tests.keys import box_pk

    client.post("/auth/register", json={"username": "takenhandle", "password": "secret123"})
    denied = client.post(
        "/auth/register-device",
        json={"username": "TakenHandle", "public_key": box_pk("dup-handle"), "device_secret": "s" * 32},
    )
    assert denied.status_code == 409


def test_register_device_rejects_duplicate_public_key(client: TestClient) -> None:
    from tests.keys import box_pk

    pk = box_pk("shared-pk")
    first = client.post(
        "/auth/register-device",
        json={"username": "keyowner", "public_key": pk, "device_secret": "a" * 32},
    )
    assert first.status_code == 200
    stolen = client.post(
        "/auth/register-device",
        json={"username": "keythief", "public_key": pk, "device_secret": "b" * 32},
    )
    assert stolen.status_code == 409
    assert "user" not in stolen.json() or "id" not in stolen.json().get("user", {})


def test_device_session_reissues_token_without_new_user(client: TestClient) -> None:
    from tests.keys import box_pk

    secret = "c" * 32
    registered = client.post(
        "/auth/register-device",
        json={"username": "devback", "public_key": box_pk("dev-back"), "device_secret": secret},
    )
    user_id = registered.json()["user"]["id"]
    again = client.post("/auth/device", json={"device_secret": secret})
    assert again.status_code == 200
    assert again.json()["user"]["id"] == user_id
    me = client.get("/users/me", headers={"Authorization": f"Bearer {again.json()['token']}"})
    assert me.status_code == 200
    assert me.json()["id"] == user_id


def test_device_account_cannot_password_login(client: TestClient) -> None:
    from tests.keys import box_pk

    client.post(
        "/auth/register-device",
        json={"username": "nopass", "public_key": box_pk("no-pass"), "device_secret": "e" * 32},
    )
    denied = client.post("/auth/login", json={"username": "nopass", "password": "secret123"})
    assert denied.status_code == 401


def test_password_register_still_works(client: TestClient) -> None:
    registered = client.post("/auth/register", json={"username": "legacy", "password": "secret123"})
    assert registered.status_code == 200
    login = client.post("/auth/login", json={"username": "legacy", "password": "secret123"})
    assert login.status_code == 200


def test_handle_available_and_unique_change(client: TestClient) -> None:
    from tests.keys import box_pk

    open_handle = client.get("/auth/handle-available", params={"username": "freshhop"})
    assert open_handle.status_code == 200
    assert open_handle.json()["available"] is True

    token = client.post("/auth/register", json={"username": "handlea", "password": "secret123"}).json()["token"]
    client.post("/auth/register", json={"username": "handleb", "password": "secret123"})
    taken = client.get("/auth/handle-available", params={"username": "HandleB"})
    assert taken.json()["available"] is False

    headers = {"Authorization": f"Bearer {token}"}
    me_before = client.get("/users/me", headers=headers).json()
    denied = client.put("/users/me/handle", json={"username": "handleb"}, headers=headers)
    assert denied.status_code == 409
    changed = client.put("/users/me/handle", json={"username": "handlea2"}, headers=headers)
    assert changed.status_code == 200
    assert changed.json()["id"] == me_before["id"]
    assert changed.json()["username"] == "handlea2"
    assert changed.json()["identity_public_key"] == me_before["identity_public_key"]

    pk = box_pk("handle-id")
    client.put("/users/me/identity", json={"public_key": pk}, headers=headers)
    renamed = client.put("/users/me/handle", json={"username": "handlea3"}, headers=headers)
    assert renamed.status_code == 200
    assert renamed.json()["id"] == me_before["id"]
    assert renamed.json()["identity_public_key"] == pk


def test_register_device_rejects_malformed_public_key(client: TestClient) -> None:
    denied = client.post(
        "/auth/register-device",
        json={"username": "badpk", "public_key": "A" * 32, "device_secret": "f" * 32},
    )
    assert denied.status_code == 400
