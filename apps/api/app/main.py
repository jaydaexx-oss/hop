from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

from app.api import api_router
from app.config import MAX_REQUEST_BYTES, assert_production_config, get_settings
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
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)

if settings.metrics_enabled:
    app.middleware("http")(metrics_middleware())


@app.middleware("http")
async def limit_request_body(request: Request, call_next):
    length = request.headers.get("content-length")
    if length is not None:
        try:
            size = int(length)
        except ValueError:
            return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
        if size > MAX_REQUEST_BYTES:
            return JSONResponse({"detail": "Request body too large"}, status_code=413)
    return await call_next(request)


@app.middleware("http")
async def access_log_without_bodies(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    logger.info(
        "http %s %s %s %sms",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )
    return response


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
