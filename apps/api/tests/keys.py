from __future__ import annotations

import base64


def box_pk(label: str) -> str:
    """Unique well-formed 32-byte identity public key for tests."""
    raw = (label.encode("utf-8") + b"\x00" * 32)[:32]
    return base64.b64encode(raw).decode("ascii")
