from __future__ import annotations

import hmac
import os
import time
from collections import defaultdict

from fastapi import HTTPException, Request

from app.config import get_settings

AUTH_LIMIT = int(os.environ.get("RATE_LIMIT_AUTH", "30"))
AUTH_WINDOW_S = float(os.environ.get("RATE_LIMIT_AUTH_WINDOW", "60"))
MESSAGE_LIMIT = int(os.environ.get("RATE_LIMIT_MESSAGE", "60"))
MESSAGE_WINDOW_S = float(os.environ.get("RATE_LIMIT_MESSAGE_WINDOW", "60"))
REGISTER_DEVICE_LIMIT = int(os.environ.get("RATE_LIMIT_REGISTER_DEVICE", "3"))
REGISTER_DEVICE_IP_LIMIT = int(os.environ.get("RATE_LIMIT_REGISTER_DEVICE_IP", "5"))
REGISTER_DEVICE_WINDOW_S = float(os.environ.get("RATE_LIMIT_REGISTER_DEVICE_WINDOW", "86400"))
DEV_RATE_LIMIT_RESET_HEADER = "x-hop-dev-reset-key"


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

    def drop(self, key: str) -> None:
        self._hits.pop(key, None)


_memory_limiter = SlidingWindowLimiter()


def _redis_client():
    import redis

    return redis.from_url(get_settings().redis_url, socket_connect_timeout=0.5)


def _redis_allow(key: str, limit: int, window_s: int) -> bool | None:
    try:
        client = _redis_client()
        bucket = int(time.time()) // max(window_s, 1)
        redis_key = f"hop:rl:{key}:{bucket}"
        count = client.incr(redis_key)
        if count == 1:
            client.expire(redis_key, window_s + 1)
        return count <= limit
    except Exception:
        return None


def _redis_drop(key: str, window_s: int) -> bool | None:
    """Delete current and previous window buckets. None if Redis is unavailable."""
    try:
        client = _redis_client()
        width = max(window_s, 1)
        now_bucket = int(time.time()) // width
        for bucket in (now_bucket, now_bucket - 1):
            client.delete(f"hop:rl:{key}:{bucket}")
        return True
    except Exception:
        return None


def _drop_limit(key: str, window_s: float) -> None:
    _redis_drop(key, int(window_s))
    _memory_limiter.drop(key)


def _allow(key: str, limit: int, window_s: float) -> bool:
    settings = get_settings()
    redis_result = _redis_allow(key, limit, int(window_s))
    if redis_result is not None:
        return redis_result
    if settings.is_production:
        # Do not silently widen to per-process memory in production (multi-worker bypass).
        raise HTTPException(status_code=503, detail="Rate limiter unavailable")
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


def limit_new_account(request: Request, install_hash: str | None) -> None:
    """Rate-limit minting a new user_id. Install hash is opaque SHA-256; IP is coarse."""
    ip = client_ip(request)
    if not _allow(f"regdev:ip:{ip}", REGISTER_DEVICE_IP_LIMIT, REGISTER_DEVICE_WINDOW_S):
        raise HTTPException(status_code=429, detail="Too many new accounts from this network")
    if install_hash and not _allow(
        f"regdev:install:{install_hash}", REGISTER_DEVICE_LIMIT, REGISTER_DEVICE_WINDOW_S
    ):
        raise HTTPException(status_code=429, detail="Too many new accounts from this app install")


def reset_limiters() -> None:
    _memory_limiter.reset()


def _truthy_env(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _secrets_equal(provided: str, expected: str) -> bool:
    if not provided or not expected:
        return False
    left = provided.encode("utf-8")
    right = expected.encode("utf-8")
    if len(left) != len(right):
        return False
    return hmac.compare_digest(left, right)


def dev_account_creation_reset_enabled() -> bool:
    """Mint-counter reset only. Never deletes blocks or install cooldowns.

    Production (`APP_ENV=production`) requires ENABLE_DEV_RATE_LIMIT_RESET=true
    and a non-empty DEV_RATE_LIMIT_RESET_KEY. Leave both unset on hop-uokqmg.
    Non-production APIs allow the endpoint without the flag.
    """
    flag = _truthy_env("ENABLE_DEV_RATE_LIMIT_RESET")
    key = os.environ.get("DEV_RATE_LIMIT_RESET_KEY", "").strip()
    if get_settings().is_production:
        return flag and bool(key)
    return True


def require_dev_account_creation_reset(request: Request) -> None:
    if not dev_account_creation_reset_enabled():
        raise HTTPException(status_code=404, detail="Not found")
    expected = os.environ.get("DEV_RATE_LIMIT_RESET_KEY", "").strip()
    if not expected:
        return
    provided = (request.headers.get(DEV_RATE_LIMIT_RESET_HEADER) or "").strip()
    if not _secrets_equal(provided, expected):
        raise HTTPException(status_code=404, detail="Not found")


def clear_new_account_mint_limits(request: Request, install_hash: str | None) -> list[str]:
    """Drop register-device mint buckets for this request's source IP and optional install hash.

    The IP key is `regdev:ip:{client_ip(request)}` — the TCP/proxy peer of *this* HTTP
    call. A Mac curl therefore cannot clear an iPhone's cellular or Wi-Fi bucket.
    On a local test API, the hidden in-app reset (phone sends X-Hop-Install) is the
    way to clear that phone's seen IP. Does not touch `block_install_cooldowns`,
    BlockedUser rows, or hop.install.id.
    """
    cleared: list[str] = []
    ip_key = f"regdev:ip:{client_ip(request)}"
    _drop_limit(ip_key, REGISTER_DEVICE_WINDOW_S)
    cleared.append("ip")
    if install_hash:
        _drop_limit(f"regdev:install:{install_hash}", REGISTER_DEVICE_WINDOW_S)
        cleared.append("install")
    return cleared
