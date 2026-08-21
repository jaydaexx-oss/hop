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
    body = response.json()
    assert body["service"] == "hop-api"
    assert "env" in body
    assert body["env"]


def test_unimplemented_push_returns_404_not_offered(client: TestClient) -> None:
    response = client.post("/push/register")
    assert response.status_code == 404
    assert "not offered" in response.json()["detail"].lower()


def test_unimplemented_devices_and_sync_return_501(client: TestClient) -> None:
    devices = client.get("/devices")
    sync = client.get("/sync")
    assert devices.status_code == 501
    assert sync.status_code == 501
    assert devices.json()["detail"] == "Not implemented"
    assert sync.json()["detail"] == "Not implemented"
