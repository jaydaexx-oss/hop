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


_memory_limiter = SlidingWindowLimiter()


def _redis_allow(key: str, limit: int, window_s: int) -> bool | None:
    try:
        import redis

        client = redis.from_url(get_settings().redis_url, socket_connect_timeout=0.5)
        bucket = int(time.time()) // max(window_s, 1)
        redis_key = f"hop:rl:{key}:{bucket}"
        count = client.incr(redis_key)
        if count == 1:
            client.expire(redis_key, window_s + 1)
        return count <= limit
    except Exception:
        return None


def _allow(key: str, limit: int, window_s: float) -> bool:
    redis_result = _redis_allow(key, limit, int(window_s))
    if redis_result is not None:
        return redis_result
    return _memory_limiter.allow(key, limit, window_s)


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
    if not _allow(f"auth:{ip}", AUTH_LIMIT, AUTH_WINDOW_S):
        raise HTTPException(status_code=429, detail="Too many authentication attempts")


def limit_messages(request: Request) -> None:
    ip = client_ip(request)
    if not _allow(f"msg:{ip}", MESSAGE_LIMIT, MESSAGE_WINDOW_S):
        raise HTTPException(status_code=429, detail="Too many messages")


def reset_limiters() -> None:
    _memory_limiter.reset()
