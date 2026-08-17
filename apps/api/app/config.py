from __future__ import annotations

import os
from collections.abc import Mapping
from functools import lru_cache
from typing import Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.db_url import normalize_database_url

PLACEHOLDER = "CHANGE_ME"
DEFAULT_DATABASE_URL = "postgresql+psycopg://hop@localhost:5432/hop"
# Opaque crypto_box JSON is capped at 64KiB; allow headers/JSON wrapping headroom.
MAX_REQUEST_BYTES = 262_144


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", populate_by_name=True)

    app_env: str = Field(default="development", validation_alias="APP_ENV")
    app_version: str = Field(default="0.1.0", validation_alias="APP_VERSION")
    log_level: str = Field(default="INFO", validation_alias="LOG_LEVEL")
    log_format: str = Field(default="text", validation_alias="LOG_FORMAT")

    database_url: str = Field(
        default=DEFAULT_DATABASE_URL,
        validation_alias="DATABASE_URL",
    )

    @field_validator("database_url", mode="before")
    @classmethod
    def _normalize_database_url(cls, value: object) -> str:
        if value is None:
            raise ValueError("DATABASE_URL is empty")
        return normalize_database_url(str(value), allow_sqlite=True)

    redis_url: str = Field(default="redis://localhost:6379/0", validation_alias="REDIS_URL")

    api_host: str = Field(default="0.0.0.0", validation_alias="API_HOST")
    api_port: int = Field(default=8000, validation_alias="API_PORT")
    cors_origins: str = Field(
        default="http://localhost:8081,http://127.0.0.1:8081",
        validation_alias="CORS_ORIGINS",
    )
    # Public HTTPS origin clients should use. Empty in development. Required in production.
    api_public_url: str = Field(default="", validation_alias="API_PUBLIC_URL")

    trust_proxy_headers: bool = Field(default=False, validation_alias="TRUST_PROXY_HEADERS")
    docs_enabled: Optional[bool] = Field(default=None, validation_alias="DOCS_ENABLED")
    metrics_enabled: bool = Field(default=True, validation_alias="METRICS_ENABLED")

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"production", "prod"}

    @property
    def openapi_enabled(self) -> bool:
        if self.docs_enabled is not None:
            return self.docs_enabled
        return not self.is_production


def assert_production_config(
    settings: Settings,
    environ: Mapping[str, str] | None = None,
) -> None:
    """Fail closed in production. Development/staging keep local defaults."""
    if not settings.is_production:
        return
    env = environ if environ is not None else os.environ
    problems: list[str] = []
    if not str(env.get("DATABASE_URL", "")).strip():
        problems.append("DATABASE_URL must be set")
    elif PLACEHOLDER in settings.database_url or settings.database_url == DEFAULT_DATABASE_URL:
        problems.append("DATABASE_URL is still the development default or a CHANGE_ME placeholder")
    if not str(env.get("REDIS_URL", "")).strip():
        problems.append("REDIS_URL must be set")
    elif PLACEHOLDER in settings.redis_url:
        problems.append("REDIS_URL still contains CHANGE_ME")
    elif _is_loopback_url(settings.redis_url):
        problems.append("REDIS_URL must not point at localhost in production")
    if settings.database_url.startswith("sqlite"):
        problems.append("DATABASE_URL must be PostgreSQL in production (not sqlite)")
    elif _is_loopback_url(settings.database_url) and settings.database_url != DEFAULT_DATABASE_URL:
        problems.append("DATABASE_URL must not point at localhost in production")
    cors = settings.cors_origins.strip()
    origins = [item.strip() for item in cors.split(",") if item.strip()]
    if not origins or "*" in origins:
        problems.append("CORS_ORIGINS must be an explicit allow-list (not *)")
    if PLACEHOLDER in cors:
        problems.append("CORS_ORIGINS still contains CHANGE_ME")
    for origin in origins:
        lowered = origin.lower()
        if "*" in origin:
            continue
        if "localhost" in lowered or "127.0.0.1" in lowered or "0.0.0.0" in lowered:
            problems.append("CORS_ORIGINS must not include localhost in production")
            break
        if origin.startswith("http://"):
            problems.append("CORS_ORIGINS must be HTTPS in production")
            break
    public_url = str(env.get("API_PUBLIC_URL", settings.api_public_url)).strip()
    if not public_url:
        problems.append("API_PUBLIC_URL must be set")
    elif PLACEHOLDER in public_url:
        problems.append("API_PUBLIC_URL still contains CHANGE_ME")
    else:
        lowered_public = public_url.lower()
        if not lowered_public.startswith("https://"):
            problems.append("API_PUBLIC_URL must be HTTPS in production")
        if _is_loopback_url(public_url):
            problems.append("API_PUBLIC_URL must not point at localhost in production")
    if problems:
        raise RuntimeError("Refusing to start in production: " + "; ".join(problems))


def _is_loopback_url(value: str) -> bool:
    lowered = value.lower()
    return "localhost" in lowered or "127.0.0.1" in lowered or "0.0.0.0" in lowered


@lru_cache
def get_settings() -> Settings:
    return Settings()
