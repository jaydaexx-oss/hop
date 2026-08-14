from fastapi.testclient import TestClient


def test_register_login_me_logout(client: TestClient) -> None:
    registered = client.post("/auth/register", json={"username": "Ada", "password": "secret123"})
    assert registered.status_code == 200
    body = registered.json()
    assert body["user"]["username"] == "ada"
    token = body["token"]

    me = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    assert me.json()["username"] == "ada"

    login = client.post("/auth/login", json={"username": "ada", "password": "secret123"})
    assert login.status_code == 200
    token2 = login.json()["token"]

    logged_out = client.post("/auth/logout", headers={"Authorization": f"Bearer {token2}"})
    assert logged_out.status_code == 200
    denied = client.get("/users/me", headers={"Authorization": f"Bearer {token2}"})
    assert denied.status_code == 401


def test_duplicate_username(client: TestClient) -> None:
    client.post("/auth/register", json={"username": "sam", "password": "secret123"})
    again = client.post("/auth/register", json={"username": "Sam", "password": "secret123"})
    assert again.status_code == 409


def test_bad_login(client: TestClient) -> None:
    client.post("/auth/register", json={"username": "jordan", "password": "secret123"})
    response = client.post("/auth/login", json={"username": "jordan", "password": "wrongpass"})
    assert response.status_code == 401
