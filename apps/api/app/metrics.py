from __future__ import annotations

import time
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Gauge, Histogram, generate_latest

REQUESTS = Counter(
    "hop_http_requests_total",
    "Total HTTP requests",
    ["method", "path", "status"],
)
REQUEST_LATENCY = Histogram(
    "hop_http_request_duration_seconds",
    "HTTP request latency",
    ["method", "path"],
    buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)
READY = Gauge("hop_ready", "1 when database and redis are reachable")


def metrics_middleware() -> Callable[[Request, Callable[[Request], Awaitable[Response]]], Awaitable[Response]]:
    async def middleware(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        if request.url.path == "/metrics":
            return await call_next(request)
        start = time.perf_counter()
        response = await call_next(request)
        elapsed = time.perf_counter() - start
        path = request.url.path
        REQUESTS.labels(request.method, path, str(response.status_code)).inc()
        REQUEST_LATENCY.labels(request.method, path).observe(elapsed)
        return response

    return middleware


def metrics_payload() -> tuple[bytes, str]:
    return generate_latest(), CONTENT_TYPE_LATEST
