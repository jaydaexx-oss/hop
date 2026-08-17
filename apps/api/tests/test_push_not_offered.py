from fastapi.testclient import TestClient


def test_push_register_is_404_not_offered(client: TestClient) -> None:
    response = client.post("/push/register")
    assert response.status_code == 404
    assert "not offered" in response.json()["detail"].lower()


def test_push_is_absent_from_openapi_when_enabled(client: TestClient) -> None:
    spec = client.get("/openapi.json")
    if spec.status_code == 404:
        return
    body = spec.json()
    paths = body.get("paths") or {}
    assert "/push/register" not in paths
