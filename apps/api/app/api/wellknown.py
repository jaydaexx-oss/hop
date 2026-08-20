from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.config import get_settings

router = APIRouter(tags=["well-known"])


@router.get("/.well-known/apple-app-site-association")
def apple_app_site_association() -> JSONResponse:
    """Minimum Associated Domains config for iOS passkeys. Empty team id → 404."""
    team = get_settings().apple_team_id.strip()
    if not team:
        return JSONResponse({"detail": "Associated Domains are not configured"}, status_code=404)
    body = {
        "webcredentials": {"apps": [f"{team}.app.hop.mobile"]},
        "applinks": {"apps": [], "details": []},
    }
    return JSONResponse(body, media_type="application/json")
