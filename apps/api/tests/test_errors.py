from app.errors import SAFE_PRODUCTION_DETAIL, client_error_payload


def test_production_error_payload_is_sanitized() -> None:
    payload = client_error_payload(
        RuntimeError("secret_key leaked traceback"),
        is_production=True,
        request_id="rid-1",
    )
    assert payload["detail"] == SAFE_PRODUCTION_DETAIL
    assert payload["request_id"] == "rid-1"
    assert "secret_key" not in payload["detail"]
    assert "traceback" not in payload["detail"].lower()


def test_development_error_payload_keeps_message() -> None:
    payload = client_error_payload(
        RuntimeError("boom for tests"),
        is_production=False,
        request_id="rid-2",
    )
    assert payload["detail"] == "boom for tests"
    assert payload["request_id"] == "rid-2"
