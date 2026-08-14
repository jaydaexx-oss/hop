from __future__ import annotations

import json

from typing import Optional

CRYPTO_BOX_ALG = "crypto_box_xsalsa20poly1305"


def is_crypto_box_payload(payload: str) -> bool:
    try:
        data = json.loads(payload)
    except (json.JSONDecodeError, TypeError, ValueError):
        return False
    if not isinstance(data, dict):
        return False
    if data.get("v") != 1 or data.get("alg") != CRYPTO_BOX_ALG:
        return False
    for key in ("sender_pk", "nonce", "ciphertext"):
        value = data.get(key)
        if not isinstance(value, str) or not value:
            return False
    return True


def decode_text(payload: str) -> Optional[str]:
    """Never used to open crypto_box. Returns None for sealed payloads."""
    if is_crypto_box_payload(payload):
        return None
    return None
