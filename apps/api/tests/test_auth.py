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
