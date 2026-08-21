from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.db import get_engine
from app.models.tables import BlockInstallCooldown, BlockedUser
from app.rate_limit import reset_limiters
from app.security import hash_token
from tests.keys import box_pk

AUTH_PY = Path(__file__).resolve().parents[1] / "app" / "api" / "auth.py"
RATE_LIMIT_PY = Path(__file__).resolve().parents[1] / "app" / "rate_limit.py"
RESET_PATH = "/auth/dev/reset-account-creation-limits"


def _register_device(client: TestClient, username: str, label: str, install: str, secret: str | None = None):
    return client.post(
        "/auth/register-device",
        json={
            "username": username,
            "public_key": box_pk(label),
            "device_secret": secret or (label + "x" * 32)[:32],
        },
        headers={"X-Hop-Install": install},
    )


def test_fly_does_not_enable_dev_rate_limit_reset() -> None:
    fly = Path(__file__).resolve().parents[1] / "fly.toml"
    text = fly.read_text()
    assert "ENABLE_DEV_RATE_LIMIT_RESET" not in text
    assert "DEV_RATE_LIMIT_RESET_KEY" not in text
    src = RATE_LIMIT_PY.read_text()
    assert 'RATE_LIMIT_REGISTER_DEVICE", "3"' in src
    assert 'RATE_LIMIT_REGISTER_DEVICE_IP", "5"' in src
    assert 'RATE_LIMIT_REGISTER_DEVICE_WINDOW", "86400"' in src
    blocks = (Path(__file__).resolve().parents[1] / "app" / "blocks.py").read_text()
    assert 'BLOCK_INSTALL_COOLDOWN_S", str(7 * 24 * 60 * 60)' in blocks


def test_recovery_and_bind_do_not_call_new_account_limiter() -> None:
    src = AUTH_PY.read_text()
    recover = src.split("def recover_password", 1)[1].split("def recover_bind_device", 1)[0]
    bind = src.split("def recover_bind_device", 1)[1].split("def reset_account_creation_limits", 1)[0]
    handle = src.split("def handle_available", 1)[1].split("def register_device", 1)[0]
    options = src.split("def recovery_options", 1)[1].split("def recover_password", 1)[0]
    passkey_complete = src.split("def passkey_authenticate_complete", 1)[1]
    for body in (recover, bind, handle, options, passkey_complete):
        assert "limit_new_account(" not in body
        assert "limit_auth(" in body
    mint = src.split("def register_device", 1)[1].split("def device_session", 1)[0]
    assert "limit_new_account(" in mint


def test_recovery_is_not_blocked_by_register_device_mint_limit(client: TestClient, monkeypatch) -> None:
    import app.rate_limit as rl

    monkeypatch.setattr(rl, "REGISTER_DEVICE_LIMIT", 2)
    monkeypatch.setattr(rl, "REGISTER_DEVICE_IP_LIMIT", 10)
    reset_limiters()
    install = "d" * 64
    try:
        created = client.post("/auth/register", json={"username": "aclimjay", "password": "secret123"})
        assert created.status_code == 200
        user_id = created.json()["user"]["id"]
        pk = box_pk("aclim-jay-id")
        assert (
            client.put(
                "/users/me/identity",
                json={"public_key": pk},
                headers={"Authorization": f"Bearer {created.json()['token']}"},
            ).status_code
            == 200
        )

        assert _register_device(client, "aclimone", "aclim-1", install).status_code == 200
        assert _register_device(client, "aclimtwo", "aclim-2", install).status_code == 200
        denied = _register_device(client, "aclimthree", "aclim-3", install)
        assert denied.status_code == 429
        assert denied.json()["detail"] == "Too many new accounts from this app install"

        available = client.get("/auth/handle-available", params={"username": "aclimjay"})
        assert available.status_code == 200
        assert available.json()["available"] is False
        options = client.get("/auth/recovery-options", params={"username": "aclimjay"})
        assert options.status_code == 200
        assert options.json()["legacy_password"] is True

        recovered = client.post(
            "/auth/recover/password",
            json={"username": "aclimjay", "password": "secret123"},
        )
        assert recovered.status_code == 200
        assert recovered.json()["user"]["id"] == user_id
        bound = client.post(
            "/auth/recover/bind-device",
            json={"device_secret": "aclim-recover-bind-after-mint-32ok"},
            headers={"Authorization": f"Bearer {recovered.json()['token']}"},
        )
        assert bound.status_code == 200
        assert bound.json()["user"]["id"] == user_id
        assert bound.json()["user"]["identity_public_key"] == pk

        still_denied = _register_device(client, "aclimfour", "aclim-4", install)
        assert still_denied.status_code == 429
    finally:
        reset_limiters()


def test_production_path_still_429s_after_three_registers(client: TestClient, monkeypatch) -> None:
    import app.rate_limit as rl

    monkeypatch.setattr(rl, "REGISTER_DEVICE_LIMIT", 3)
    monkeypatch.setattr(rl, "REGISTER_DEVICE_IP_LIMIT", 10)
    reset_limiters()
    install = "e" * 64
    try:
        for i in range(3):
            ok = _register_device(client, f"acplim{i}", f"acplim-{i}", install)
            assert ok.status_code == 200
        denied = _register_device(client, "acplim3", "acplim-3", install)
        assert denied.status_code == 429
    finally:
        reset_limiters()


def test_dev_reset_404_when_production_flag_off(client: TestClient, monkeypatch) -> None:
    from app.config import get_settings

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("ENABLE_DEV_RATE_LIMIT_RESET", raising=False)
    monkeypatch.delenv("DEV_RATE_LIMIT_RESET_KEY", raising=False)
    get_settings.cache_clear()
    try:
        response = client.post(RESET_PATH, headers={"X-Hop-Install": "a" * 64})
        assert response.status_code == 404
    finally:
        monkeypatch.setenv("APP_ENV", "development")
        get_settings.cache_clear()


def test_dev_reset_404_when_production_flag_on_but_key_unset(client: TestClient, monkeypatch) -> None:
    from app.config import get_settings

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("ENABLE_DEV_RATE_LIMIT_RESET", "true")
    monkeypatch.delenv("DEV_RATE_LIMIT_RESET_KEY", raising=False)
    get_settings.cache_clear()
    try:
        response = client.post(RESET_PATH, headers={"X-Hop-Install": "a" * 64})
        assert response.status_code == 404
    finally:
        monkeypatch.setenv("APP_ENV", "development")
        monkeypatch.delenv("ENABLE_DEV_RATE_LIMIT_RESET", raising=False)
        get_settings.cache_clear()


def test_dev_reset_clears_mint_buckets_not_blocks(client: TestClient, monkeypatch) -> None:
    import app.rate_limit as rl

    monkeypatch.setattr(rl, "REGISTER_DEVICE_LIMIT", 2)
    monkeypatch.setattr(rl, "REGISTER_DEVICE_IP_LIMIT", 10)
    reset_limiters()
    install = "f" * 64
    try:
        blocker = client.post("/auth/register", json={"username": "aclimvic", "password": "secret123"})
        assert blocker.status_code == 200
        token_a = blocker.json()["token"]
        id_a = blocker.json()["user"]["id"]
        first = _register_device(client, "aclimrst", "aclim-rst-1", install)
        assert first.status_code == 200
        id_b = first.json()["user"]["id"]
        assert (
            client.post("/users/me/blocks", json={"username": "aclimrst"}, headers={"Authorization": f"Bearer {token_a}"}).status_code
            == 200
        )
        assert _register_device(client, "aclimrs2", "aclim-rst-2", install).status_code == 200
        assert _register_device(client, "aclimrs3", "aclim-rst-3", install).status_code == 429

        reset = client.post(RESET_PATH, headers={"X-Hop-Install": install})
        assert reset.status_code == 200
        body = reset.json()
        assert body["status"] == "ok"
        assert body["blocks_unchanged"] is True
        assert "install" in body["cleared"]
        assert "ip" in body["cleared"]

        with Session(get_engine()) as session:
            assert session.get(BlockedUser, (id_a, id_b)) is not None
            cooldown = session.get(BlockInstallCooldown, (id_a, hash_token(install)))
            assert cooldown is not None
            remaining = session.exec(select(BlockedUser).where(BlockedUser.blocked_user_id == id_b)).all()
            assert remaining

        allowed = _register_device(client, "aclimrs4", "aclim-rst-4", install)
        assert allowed.status_code == 200
        denied_contact = client.post(
            "/conversations",
            json={"username": "aclimvic"},
            headers={"Authorization": f"Bearer {allowed.json()['token']}"},
        )
        assert denied_contact.status_code == 403
    finally:
        reset_limiters()


def test_dev_reset_404_on_wrong_key_when_key_configured(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("DEV_RATE_LIMIT_RESET_KEY", "unit-test-reset-key-not-for-git")
    denied = client.post(
        RESET_PATH,
        headers={"X-Hop-Install": "a" * 64, "X-Hop-Dev-Reset-Key": "wrong-key"},
    )
    assert denied.status_code == 404
    ok = client.post(
        RESET_PATH,
        headers={"X-Hop-Install": "a" * 64, "X-Hop-Dev-Reset-Key": "unit-test-reset-key-not-for-git"},
    )
    assert ok.status_code == 200
    monkeypatch.delenv("DEV_RATE_LIMIT_RESET_KEY", raising=False)
