from __future__ import annotations

import base64
import json

from typing import Optional

UNENCRYPTED_ALG = "none"


def encode_text(text: str) -> str:
    blob = json.dumps({"v": 0, "alg": UNENCRYPTED_ALG, "text": text}, ensure_ascii=False)
    return base64.b64encode(blob.encode("utf-8")).decode("ascii")


def decode_text(payload: str) -> Optional[str]:
    try:
        raw = base64.b64decode(payload.encode("ascii"))
        data = json.loads(raw.decode("utf-8"))
        if data.get("alg") != UNENCRYPTED_ALG:
            return None
        text = data.get("text")
        return text if isinstance(text, str) else None
    except Exception:
        return None
