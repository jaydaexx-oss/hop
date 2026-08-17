from __future__ import annotations

import base64
import binascii
import re

BOX_PUBLIC_KEY_BYTES = 32
_B64_RE = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")


def is_well_formed_box_public_key(value: str) -> bool:
    """Structural X25519 public key check: canonical base64 of 32 bytes. Not possession."""
    if not isinstance(value, str) or not value:
        return False
    if value.strip() != value:
        return False
    if any(ch.isspace() for ch in value):
        return False
    if not _B64_RE.match(value):
        return False
    try:
        raw = base64.b64decode(value, validate=True)
    except (binascii.Error, ValueError):
        return False
    if len(raw) != BOX_PUBLIC_KEY_BYTES:
        return False
    roundtrip = base64.b64encode(raw).decode("ascii")
    return roundtrip == value or roundtrip.rstrip("=") == value.rstrip("=")
