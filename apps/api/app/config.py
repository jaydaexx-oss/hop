from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = Field(default="development", validation_alias="APP_ENV")
    app_version: str = Field(default="0.1.0", validation_alias="APP_VERSION")
    log_level: str = Field(default="INFO", validation_alias="LOG_LEVEL")
    log_format: str = Field(default="text", validation_alias="LOG_FORMAT")

    database_url: str = Field(
        default="postgresql+psycopg://hop@localhost:5432/hop",
        validation_alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://localhost:6379/0", validation_alias="REDIS_URL")

    api_host: str = Field(default="0.0.0.0", validation_alias="API_HOST")
    api_port: int = Field(default=8000, validation_alias="API_PORT")
    cors_origins: str = Field(
        default="http://localhost:8081,http://127.0.0.1:8081",
        validation_alias="CORS_ORIGINS",
    )

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
