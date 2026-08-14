from fastapi.testclient import TestClient


def test_health_ok(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "hop-api"
    assert "version" in body


def test_live_ok(client: TestClient) -> None:
    response = client.get("/live")
    assert response.status_code == 200
    assert response.json()["status"] == "alive"


def test_ready_reports_database(client: TestClient) -> None:
    response = client.get("/ready")
    body = response.json()
    assert body["database"] == "ok"
    assert "redis" in body
    assert "version" in body


def test_metrics_endpoint(client: TestClient) -> None:
    response = client.get("/metrics")
    assert response.status_code == 200
    assert "hop_http_requests_total" in response.text


def test_version_endpoint(client: TestClient) -> None:
    response = client.get("/version")
    assert response.status_code == 200
    assert response.json()["service"] == "hop-api"


def test_unimplemented_push_returns_501(client: TestClient) -> None:
    response = client.post("/push/register")
    assert response.status_code == 501
