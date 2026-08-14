from fastapi.testclient import TestClient


def test_health_ok(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "hop-api"}


def test_ready_reports_database(client: TestClient) -> None:
    response = client.get("/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["database"] == "ok"
    assert "redis" in body


def test_unimplemented_push_returns_501(client: TestClient) -> None:
    response = client.post("/push/register")
    assert response.status_code == 501
