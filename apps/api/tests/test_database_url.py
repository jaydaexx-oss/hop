import pytest
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.db_url import normalize_database_url


def test_postgres_scheme_becomes_psycopg() -> None:
    assert (
        normalize_database_url("postgres://hop:secret@db.example:5432/hop")
        == "postgresql+psycopg://hop:secret@db.example:5432/hop"
    )


def test_postgresql_scheme_becomes_psycopg() -> None:
    assert (
        normalize_database_url("postgresql://hop:secret@db.example:5432/hop")
        == "postgresql+psycopg://hop:secret@db.example:5432/hop"
    )


def test_psycopg_scheme_unchanged() -> None:
    url = "postgresql+psycopg://hop:secret@db.example:5432/hop"
    assert normalize_database_url(url) == url


def test_password_with_special_chars_preserved() -> None:
    # Percent-encoded @ : / ? # and a literal postgres:// substring in the password.
    rest = "hop:p%40ss%3Aword%2F%3F%23-postgres://x@db.example:5432/hop"
    assert (
        normalize_database_url(f"postgres://{rest}")
        == f"postgresql+psycopg://{rest}"
    )


def test_query_string_preserved() -> None:
    url = "postgres://hop:secret@db.example:5432/hop?sslmode=require&connect_timeout=10"
    assert (
        normalize_database_url(url)
        == "postgresql+psycopg://hop:secret@db.example:5432/hop?sslmode=require&connect_timeout=10"
    )


def test_unsupported_mysql_scheme_raises() -> None:
    with pytest.raises(ValueError, match="scheme is not supported"):
        normalize_database_url("mysql://hop:secret@db.example:5432/hop")


def test_empty_and_missing_scheme_raise() -> None:
    with pytest.raises(ValueError, match="empty"):
        normalize_database_url("")
    with pytest.raises(ValueError, match="empty"):
        normalize_database_url("   ")
    with pytest.raises(ValueError, match="missing a scheme"):
        normalize_database_url("hop:secret@db.example:5432/hop")


def test_sqlite_allowed_in_non_production() -> None:
    assert normalize_database_url("sqlite://", allow_sqlite=True) == "sqlite://"
    assert normalize_database_url("sqlite:///./hop.db") == "sqlite:///./hop.db"


def test_sqlite_rejected_when_not_allowed() -> None:
    with pytest.raises(ValueError, match="scheme is not supported"):
        normalize_database_url("sqlite://", allow_sqlite=False)


def test_errors_do_not_include_credentials() -> None:
    secret = "super-secret-password"
    url = f"mysql://hop:{secret}@db.example:5432/hop"
    with pytest.raises(ValueError) as rejected:
        normalize_database_url(url)
    message = str(rejected.value)
    assert secret not in message
    assert url not in message


def test_settings_normalizes_fly_postgres_url(monkeypatch) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgres://hop:fake-pass@hop-db.internal:5432/hop?sslmode=require",
    )
    settings = Settings()
    assert (
        settings.database_url
        == "postgresql+psycopg://hop:fake-pass@hop-db.internal:5432/hop?sslmode=require"
    )


def test_get_settings_normalizes_postgresql_url(monkeypatch) -> None:
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://hop:fake-pass@hop-db.internal:5432/hop",
    )
    get_settings.cache_clear()
    try:
        assert (
            get_settings().database_url
            == "postgresql+psycopg://hop:fake-pass@hop-db.internal:5432/hop"
        )
    finally:
        get_settings.cache_clear()


def test_settings_rejects_unsupported_scheme(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "mysql://hop:fake-pass@db.example:5432/hop")
    with pytest.raises((ValueError, ValidationError)):
        Settings()
