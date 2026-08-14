from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "hop-api"}


def test_unimplemented_routes_return_501() -> None:
    response = client.post("/messages")
    assert response.status_code == 501
