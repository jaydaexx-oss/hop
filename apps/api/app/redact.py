from __future__ import annotations

import re
from typing import Any

SENSITIVE_KEYS = {
    "password",
    "token",
    "secret",
    "secret_key",
    "secretkey",
    "private_key",
    "privatekey",
    "ciphertext",
    "encrypted_payload",
    "crypto_box",
    "audio_b64",
    "audio",
    "voice",
    "authorization",
    "cookie",
    "text",
    "plaintext",
    "local_seal",
    "nonce",
}

_LONG_B64 = re.compile(r"[A-Za-z0-9+/]{48,}={0,2}")


def redact_string(message: str) -> str:
    return _LONG_B64.sub("[redacted-b64]", message)


def redact_value(value: Any, depth: int = 0) -> Any:
    if depth > 6:
        return "[truncated]"
    if value is None or isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, str):
        return redact_string(value)
    if isinstance(value, list):
        return [redact_value(item, depth + 1) for item in value[:20]]
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, nested in value.items():
            if str(key).lower() in SENSITIVE_KEYS:
                out[str(key)] = "[redacted]"
            else:
                out[str(key)] = redact_value(nested, depth + 1)
        return out
    return redact_string(str(value))


def looks_like_secret_dump(message: str) -> bool:
    if not message:
        return False
    lowered = message.lower()
    if any(token in lowered for token in ("secretkey", "privatekey", "encrypted_payload", "audio_b64")):
        return bool(_LONG_B64.search(message))
    return False
