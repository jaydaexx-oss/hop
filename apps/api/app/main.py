from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from app.api import api_router
from app.config import assert_production_config, get_settings
from app.db import init_db
from app.logging_config import configure_logging
from app.metrics import READY, metrics_middleware, metrics_payload

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_format)
    logger.info("Starting HOP API env=%s version=%s", settings.app_env, settings.app_version)
    assert_production_config(settings)
    init_db()
    yield
    logger.info("Shutting down HOP API")


settings = get_settings()
app = FastAPI(
    title="HOP API",
    version=settings.app_version,
    description=(
        "Privacy-first hybrid messaging backend. Internet bodies are opaque "
        "libsodium crypto_box payloads. See /docs when enabled."
    ),
    lifespan=lifespan,
    docs_url="/docs" if settings.openapi_enabled else None,
    redoc_url="/redoc" if settings.openapi_enabled else None,
    openapi_url="/openapi.json" if settings.openapi_enabled else None,
)

origins = [item.strip() for item in settings.cors_origins.split(",") if item.strip()]
allow_all = origins == ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all else origins,
    allow_credentials=not allow_all,
    allow_methods=["*"],
    allow_headers=["*"],
)

if settings.metrics_enabled:
    app.middleware("http")(metrics_middleware())

app.include_router(api_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "hop-api", "version": settings.app_version}


@app.get("/metrics", include_in_schema=False)
def metrics(_request: Request) -> Response:
    if not settings.metrics_enabled:
        return PlainTextResponse("metrics disabled", status_code=404)
    body, content_type = metrics_payload()
    return Response(content=body, media_type=content_type)


@app.get("/version", tags=["health"])
def version() -> dict[str, str]:
    return {"service": "hop-api", "version": settings.app_version, "env": settings.app_env}
