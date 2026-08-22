from __future__ import annotations

from fastapi import APIRouter

from app.api import stubs
from app.api.auth import router as auth_router
from app.api.conversations import router as conversations_router
from app.api.events import router as events_router
from app.api.health import router as health_router
from app.api.nearby import router as nearby_router
from app.api.realtime import router as realtime_router
from app.api.users import router as users_router
from app.api.wellknown import router as wellknown_router

api_router = APIRouter()
api_router.include_router(wellknown_router)
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(conversations_router)
api_router.include_router(events_router)
api_router.include_router(nearby_router)
api_router.include_router(realtime_router)
api_router.include_router(stubs.router)
