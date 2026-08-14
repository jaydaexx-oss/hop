from __future__ import annotations

import os
import time
from collections import defaultdict

from fastapi import HTTPException, Request

from app.config import get_settings

AUTH_LIMIT = int(os.environ.get("RATE_LIMIT_AUTH", "30"))
AUTH_WINDOW_S = float(os.environ.get("RATE_LIMIT_AUTH_WINDOW", "60"))
MESSAGE_LIMIT = int(os.environ.get("RATE_LIMIT_MESSAGE", "60"))
MESSAGE_WINDOW_S = float(os.environ.get("RATE_LIMIT_MESSAGE_WINDOW", "60"))


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = defaultdict(list)

    def allow(self, key: str, limit: int, window_s: float) -> bool:
        now = time.monotonic()
        cutoff = now - window_s
        bucket = [stamp for stamp in self._hits[key] if stamp > cutoff]
        if len(bucket) >= limit:
            self._hits[key] = bucket
            return False
        bucket.append(now)
        self._hits[key] = bucket
        return True

    def reset(self) -> None:
        self._hits.clear()


limiter = SlidingWindowLimiter()


def client_ip(request: Request) -> str:
    settings = get_settings()
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip.strip()
    if request.client is None:
        return "unknown"
    return request.client.host


def limit_auth(request: Request) -> None:
    ip = client_ip(request)
    if not limiter.allow(f"auth:{ip}", AUTH_LIMIT, AUTH_WINDOW_S):
        raise HTTPException(status_code=429, detail="Too many authentication attempts")


def limit_messages(request: Request) -> None:
    ip = client_ip(request)
    if not limiter.allow(f"msg:{ip}", MESSAGE_LIMIT, MESSAGE_WINDOW_S):
        raise HTTPException(status_code=429, detail="Too many messages")
