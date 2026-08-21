import os

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("CORS_ORIGINS", "*")
os.environ.setdefault("RATE_LIMIT_AUTH", "1000")
os.environ.setdefault("RATE_LIMIT_MESSAGE", "1000")
os.environ.setdefault("RATE_LIMIT_REGISTER_DEVICE", "1000")
os.environ.setdefault("RATE_LIMIT_REGISTER_DEVICE_IP", "1000")

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client
