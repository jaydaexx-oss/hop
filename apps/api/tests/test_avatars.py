from fastapi.testclient import TestClient

from app.avatars import AVATAR_MAX_BYTES, avatar_proxy_path


TINY_JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


def _auth(client: TestClient, username: str) -> tuple[str, dict]:
    response = client.post("/auth/register", json={"username": username, "password": "secret123"})
    body = response.json()
    return body["token"], body["user"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_avatar_upload_requires_auth(client: TestClient) -> None:
    denied = client.put("/users/me/avatar", content=TINY_JPEG, headers={"Content-Type": "image/jpeg"})
    assert denied.status_code == 401


def test_avatar_get_requires_auth(client: TestClient) -> None:
    token, user = _auth(client, "photog")
    uploaded = client.put(
        "/users/me/avatar",
        content=TINY_JPEG,
        headers={**_headers(token), "Content-Type": "image/jpeg"},
    )
    assert uploaded.status_code == 200
    public = client.get(f"/users/id/{user['id']}/avatar")
    assert public.status_code == 401


def test_avatar_upload_get_delete_and_relative_proxy_url(client: TestClient) -> None:
    token_a, user_a = _auth(client, "avaaa")
    token_b, _user_b = _auth(client, "avaab")
    headers_a = _headers(token_a)

    me = client.get("/users/me", headers=headers_a).json()
    assert me["has_avatar"] is False
    assert me["avatar_url"] is None

    uploaded = client.put(
        "/users/me/avatar",
        content=TINY_JPEG,
        headers={**headers_a, "Content-Type": "image/jpeg"},
    )
    assert uploaded.status_code == 200
    body = uploaded.json()
    assert body["has_avatar"] is True
    assert body["avatar_url"] == avatar_proxy_path(user_a["id"])
    assert body["avatar_url"].startswith("/users/id/")
    assert "://" not in body["avatar_url"]
    assert "/var/" not in body["avatar_url"]
    assert "s3" not in body["avatar_url"].lower()

    fetched = client.get(body["avatar_url"], headers=_headers(token_b))
    assert fetched.status_code == 200
    assert fetched.headers["content-type"].startswith("image/jpeg")
    assert fetched.content == TINY_JPEG
    assert "Cache-Control" in fetched.headers
    assert "private" in fetched.headers["Cache-Control"]

    convo = client.post("/conversations", json={"username": "avaaa"}, headers=_headers(token_b))
    assert convo.status_code == 200
    peer = convo.json()["peer"]
    assert peer["has_avatar"] is True
    assert peer["avatar_url"] == avatar_proxy_path(user_a["id"])

    deleted = client.delete("/users/me/avatar", headers=headers_a)
    assert deleted.status_code == 200
    assert deleted.json()["has_avatar"] is False
    assert deleted.json()["avatar_url"] is None
    missing = client.get(avatar_proxy_path(user_a["id"]), headers=_headers(token_b))
    assert missing.status_code == 404


def test_avatar_rejects_non_jpeg_and_oversize(client: TestClient) -> None:
    token, _user = _auth(client, "avbad")
    headers = {**_headers(token), "Content-Type": "image/jpeg"}
    png = client.put("/users/me/avatar", content=b"\x89PNG\r\n" + b"\x00" * 32, headers=headers)
    assert png.status_code == 400
    huge = client.put(
        "/users/me/avatar",
        content=b"\xff\xd8\xff" + b"\x00" * (AVATAR_MAX_BYTES + 8),
        headers=headers,
    )
    assert huge.status_code in {400, 413}
