import pytest

from app.config import DEFAULT_DATABASE_URL, Settings, assert_production_config
from app.rate_limit import client_ip


def test_production_disables_openapi_by_default(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("DOCS_ENABLED", raising=False)
    settings = Settings()
    assert settings.is_production is True
    assert settings.openapi_enabled is False


def test_docs_can_be_enabled_in_production(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DOCS_ENABLED", "true")
    settings = Settings()
    assert settings.openapi_enabled is True


def test_trust_proxy_headers_flag(monkeypatch) -> None:
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    settings = Settings()
    assert settings.trust_proxy_headers is True


def test_client_ip_uses_forwarded_for_when_trusted(monkeypatch) -> None:
    monkeypatch.setenv("TRUST_PROXY_HEADERS", "true")
    from app.config import get_settings

    get_settings.cache_clear()

    class FakeRequest:
        headers = {"X-Forwarded-For": "203.0.113.10, 10.0.0.1"}
        client = type("C", (), {"host": "172.18.0.1"})()

    assert client_ip(FakeRequest()) == "203.0.113.10"
    get_settings.cache_clear()


def test_production_rejects_wildcard_cors_and_default_secrets(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CORS_ORIGINS", "*")
    monkeypatch.setenv("DATABASE_URL", DEFAULT_DATABASE_URL)
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    settings = Settings()
    with pytest.raises(RuntimeError, match="CORS_ORIGINS") as rejected:
        assert_production_config(settings)
    assert "DATABASE_URL" in str(rejected.value)


def test_production_accepts_explicit_secrets(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("CORS_ORIGINS", "https://app.example.com")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://hop:secret@db:5432/hop")
    monkeypatch.setenv("REDIS_URL", "redis://redis:6379/0")
    settings = Settings()
    assert_production_config(settings)


def test_development_allows_local_defaults() -> None:
    settings = Settings()
    assert settings.is_production is False
    assert_production_config(settings)
