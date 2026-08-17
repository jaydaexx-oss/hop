from app.logging_config import JsonFormatter
from app.redact import looks_like_secret_dump, redact_string, redact_value
from fastapi.testclient import TestClient


def test_health_returns_request_id(client: TestClient) -> None:
    response = client.get("/health", headers={"X-Request-ID": "hop-test-rid"})
    assert response.status_code == 200
    assert response.headers.get("X-Request-ID") == "hop-test-rid"


def test_generated_request_id_when_missing(client: TestClient) -> None:
    response = client.get("/live")
    assert response.status_code == 200
    assert response.headers.get("X-Request-ID")


def test_redact_helpers_strip_secrets_and_ciphertext() -> None:
    payload = redact_value(
        {
            "password": "hunter2",
            "encrypted_payload": "A" * 80,
            "ciphertext": "B" * 80,
            "path": "/messages",
        }
    )
    assert payload["password"] == "[redacted]"
    assert payload["encrypted_payload"] == "[redacted]"
    assert payload["ciphertext"] == "[redacted]"
    assert payload["path"] == "/messages"
    dumped = "secretKey " + "C" * 80
    assert "[redacted-b64]" in redact_string(dumped)
    assert looks_like_secret_dump(dumped)
    voice = redact_value({"voice": "E" * 80, "audio_b64": "F" * 80, "crypto_box": "G" * 80})
    assert voice["voice"] == "[redacted]"
    assert voice["audio_b64"] == "[redacted]"
    assert voice["crypto_box"] == "[redacted]"


def test_json_formatter_redacts_long_blobs() -> None:
    import logging

    formatter = JsonFormatter()
    record = logging.LogRecord(
        name="test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="encrypted_payload " + "D" * 80,
        args=(),
        exc_info=None,
    )
    rendered = formatter.format(record)
    assert "D" * 48 not in rendered
    assert "encrypted_payload" in rendered
