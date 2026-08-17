from __future__ import annotations

from typing import Any

SAFE_PRODUCTION_DETAIL = "Internal server error"


def client_error_payload(
    exc: BaseException,
    *,
    is_production: bool,
    request_id: str | None,
) -> dict[str, Any]:
    """Clients never receive stack traces or secret-bearing exception text in production."""
    detail = SAFE_PRODUCTION_DETAIL if is_production else str(exc) or SAFE_PRODUCTION_DETAIL
    payload: dict[str, Any] = {"detail": detail}
    if request_id:
        payload["request_id"] = request_id
    return payload
