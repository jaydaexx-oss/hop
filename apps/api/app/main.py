from __future__ import annotations

from fastapi import FastAPI

from app.api import api_router

app = FastAPI(
    title="HOP API",
    version="0.1.0",
    description="Privacy-first hybrid messaging backend. Most routes are not implemented yet.",
)

app.include_router(api_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "hop-api"}
