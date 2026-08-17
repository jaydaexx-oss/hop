from __future__ import annotations

import os
import secrets
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

API_ROOT = Path(__file__).resolve().parents[1]


def _generated_prod_env() -> dict[str, str]:
    password = secrets.token_urlsafe(32)
    env = os.environ.copy()
    env.update(
        {
            "APP_ENV": "production",
            "APP_VERSION": "0.1.0-phase6-dry-run",
            "DATABASE_URL": f"postgresql+psycopg://hop:{password}@db.internal.example:5432/hop",
            "REDIS_URL": "redis://cache.internal.example:6379/0",
            "CORS_ORIGINS": "https://app.example.com",
            "API_PUBLIC_URL": "https://api.example.com",
            "DOCS_ENABLED": "false",
            "LOG_LEVEL": "WARNING",
            "LOG_FORMAT": "json",
            "PYTHONPATH": str(API_ROOT),
        }
    )
    env.pop("CHANGE_ME", None)
    return env


def test_local_prod_mode_startup_health_and_docs(tmp_path: Path) -> None:
    """Local production-mode process startup only. Not live HTTPS. Not a paid host."""
    script = tmp_path / "prod_startup.py"
    script.write_text(
        "\n".join(
            [
                "from fastapi.testclient import TestClient",
                "from app.main import app",
                "client = TestClient(app)",
                "health = client.get('/health')",
                "assert health.status_code == 200, health.text",
                "body = health.json()",
                "assert body['status'] == 'ok'",
                "assert health.headers.get('X-Request-ID')",
                "docs = client.get('/docs')",
                "assert docs.status_code in {404, 405}",
                "openapi = client.get('/openapi.json')",
                "assert openapi.status_code in {404, 405}",
                "ready = client.get('/ready')",
                "assert ready.status_code in {200, 503}",
                "ready_body = ready.json()",
                "assert 'database' in ready_body and 'redis' in ready_body",
                "print('PROD_STARTUP_OK', health.status_code, ready.status_code)",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        [sys.executable, str(script)],
        cwd=str(API_ROOT),
        env=_generated_prod_env(),
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if result.returncode != 0:
        pytest.fail(
            "local prod-mode startup failed\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )
    assert "PROD_STARTUP_OK" in result.stdout


def test_dev_client_still_serves_health_ready(client: TestClient) -> None:
    health = client.get("/health")
    assert health.status_code == 200
    ready = client.get("/ready")
    assert ready.status_code in {200, 503}
    assert ready.json()["database"] == "ok"
