from __future__ import annotations

import hashlib
import json
import secrets
from datetime import timedelta
from typing import Any
from urllib.parse import urlparse

import cbor2
from ecdsa import NIST256p, VerifyingKey
from ecdsa.util import sigdecode_der
from fastapi import HTTPException, Request
from sqlmodel import Session, select

from app.config import get_settings
from app.models.tables import PasskeyChallenge, PasskeyCredential, User, utcnow

CHALLENGE_TTL = timedelta(minutes=5)
RP_NAME = "HOP"
COSE_KTY_EC2 = 2
COSE_ALG_ES256 = -7
COSE_CRV_P256 = 1


def _b64url_encode(data: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    import base64

    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data.replace("-", "+").replace("_", "/") + pad)


def relying_party_id(request: Request) -> str:
    settings = get_settings()
    if settings.webauthn_rp_id.strip():
        return settings.webauthn_rp_id.strip()
    public = settings.api_public_url.strip()
    if public:
        host = urlparse(public).hostname
        if host:
            return host
    host = urlparse(str(request.base_url)).hostname or "localhost"
    if host in {"testserver", "127.0.0.1", "0.0.0.0"}:
        return "localhost"
    return host


def expected_origin(request: Request) -> str:
    settings = get_settings()
    header = (request.headers.get("origin") or "").strip().rstrip("/")
    if header:
        return header
    public = settings.api_public_url.strip().rstrip("/")
    if public:
        return public
    return str(request.base_url).rstrip("/")


def _purge_expired(session: Session) -> None:
    now = utcnow()
    expired = session.exec(select(PasskeyChallenge).where(PasskeyChallenge.expires_at < now)).all()
    for row in expired:
        session.delete(row)
    if expired:
        session.commit()


def _store_challenge(session: Session, challenge: bytes, purpose: str, user_id: str | None) -> PasskeyChallenge:
    _purge_expired(session)
    row = PasskeyChallenge(
        user_id=user_id,
        challenge=_b64url_encode(challenge),
        purpose=purpose,
        expires_at=utcnow() + CHALLENGE_TTL,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def _load_challenge(session: Session, challenge_id: str, purpose: str) -> PasskeyChallenge:
    row = session.get(PasskeyChallenge, challenge_id)
    if row is None or row.purpose != purpose or row.expires_at < utcnow():
        raise HTTPException(status_code=400, detail="Invalid or expired passkey challenge")
    return row


def has_passkey(session: Session, user_id: str) -> bool:
    return session.exec(select(PasskeyCredential).where(PasskeyCredential.user_id == user_id)).first() is not None


def _parse_client_data(credential: dict, expected_type: str, expected_challenge: bytes, origin: str) -> bytes:
    response = credential.get("response")
    if not isinstance(response, dict):
        raise HTTPException(status_code=400, detail="Passkey credential is missing a response")
    raw = response.get("clientDataJSON")
    if not isinstance(raw, str) or not raw:
        raise HTTPException(status_code=400, detail="Passkey credential is missing clientDataJSON")
    try:
        client_bytes = _b64url_decode(raw)
        data = json.loads(client_bytes.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Passkey clientDataJSON is invalid") from exc
    if data.get("type") != expected_type:
        raise HTTPException(status_code=400, detail="Passkey ceremony type mismatch")
    try:
        got = _b64url_decode(str(data.get("challenge") or ""))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Passkey challenge mismatch") from exc
    if got != expected_challenge:
        raise HTTPException(status_code=400, detail="Passkey challenge mismatch")
    client_origin = str(data.get("origin") or "").rstrip("/")
    if client_origin and client_origin != origin:
        raise HTTPException(status_code=400, detail="Passkey origin mismatch")
    return client_bytes


def _cose_ec2_uncompressed(cose: dict[int, Any]) -> bytes:
    if cose.get(1) != COSE_KTY_EC2 or cose.get(3) != COSE_ALG_ES256 or cose.get(-1) != COSE_CRV_P256:
        raise HTTPException(status_code=400, detail="Passkey public key must be ES256 P-256")
    x = cose.get(-2)
    y = cose.get(-3)
    if not isinstance(x, (bytes, bytearray)) or not isinstance(y, (bytes, bytearray)):
        raise HTTPException(status_code=400, detail="Passkey public key is malformed")
    if len(x) != 32 or len(y) != 32:
        raise HTTPException(status_code=400, detail="Passkey public key is malformed")
    return b"\x04" + bytes(x) + bytes(y)


def _parse_attested_public_key(attestation_object_b64: str) -> tuple[bytes, bytes, int]:
    try:
        att_obj = cbor2.loads(_b64url_decode(attestation_object_b64))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Passkey attestation is malformed") from exc
    if not isinstance(att_obj, dict) or b"authData" not in att_obj and "authData" not in att_obj:
        raise HTTPException(status_code=400, detail="Passkey attestation is malformed")
    auth_data = att_obj.get("authData") or att_obj.get(b"authData")
    if not isinstance(auth_data, (bytes, bytearray)):
        raise HTTPException(status_code=400, detail="Passkey attestation is malformed")
    if len(auth_data) < 37:
        raise HTTPException(status_code=400, detail="Passkey attestation is malformed")
    flags = auth_data[32]
    if not flags & 0x40:
        raise HTTPException(status_code=400, detail="Passkey attestation is missing the credential")
    sign_count = int.from_bytes(auth_data[33:37], "big")
    rest = auth_data[37:]
    if len(rest) < 18:
        raise HTTPException(status_code=400, detail="Passkey attestation is malformed")
    cred_len = int.from_bytes(rest[16:18], "big")
    cred_id = bytes(rest[18 : 18 + cred_len])
    cose = cbor2.loads(bytes(rest[18 + cred_len :]))
    if not isinstance(cose, dict):
        raise HTTPException(status_code=400, detail="Passkey public key is malformed")
    return cred_id, _cose_ec2_uncompressed(cose), sign_count


def _verify_assertion(public_key: bytes, authenticator_data: bytes, client_data: bytes, signature: bytes) -> None:
    signed = authenticator_data + hashlib.sha256(client_data).digest()
    try:
        vk = VerifyingKey.from_string(public_key[1:], curve=NIST256p)
        vk.verify(signature, signed, hashfunc=hashlib.sha256, sigdecode=sigdecode_der)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Passkey authentication failed") from exc


def registration_begin(session: Session, user: User, request: Request) -> dict[str, Any]:
    challenge = secrets.token_bytes(32)
    row = _store_challenge(session, challenge, "register", user.id)
    options = {
        "rp": {"id": relying_party_id(request), "name": RP_NAME},
        "user": {
            "id": _b64url_encode(user.id.encode("utf-8")),
            "name": user.username,
            "displayName": user.username,
        },
        "challenge": _b64url_encode(challenge),
        "pubKeyCredParams": [{"type": "public-key", "alg": COSE_ALG_ES256}],
        "timeout": 60000,
        "attestation": "none",
        "authenticatorSelection": {
            "residentKey": "preferred",
            "userVerification": "required",
        },
    }
    return {"challenge_id": row.id, "options": options}


def registration_complete(session: Session, user: User, request: Request, challenge_id: str, credential: dict) -> None:
    row = _load_challenge(session, challenge_id, "register")
    if row.user_id != user.id:
        raise HTTPException(status_code=400, detail="Passkey challenge does not belong to this account")
    _parse_client_data(credential, "webauthn.create", _b64url_decode(row.challenge), expected_origin(request))
    response = credential.get("response")
    if not isinstance(response, dict) or not isinstance(response.get("attestationObject"), str):
        raise HTTPException(status_code=400, detail="Passkey registration failed")
    cred_id, public_key, sign_count = _parse_attested_public_key(response["attestationObject"])
    cred_id_b64 = _b64url_encode(cred_id)
    existing = session.get(PasskeyCredential, cred_id_b64)
    if existing is not None and existing.user_id != user.id:
        raise HTTPException(status_code=409, detail="Passkey already registered to another account")
    if existing is None:
        session.add(
            PasskeyCredential(
                id=cred_id_b64,
                user_id=user.id,
                public_key=_b64url_encode(public_key),
                sign_count=sign_count,
            )
        )
    session.delete(row)
    session.commit()


def authentication_begin(session: Session, user: User, request: Request) -> dict[str, Any]:
    creds = session.exec(select(PasskeyCredential).where(PasskeyCredential.user_id == user.id)).all()
    if not creds:
        raise HTTPException(status_code=404, detail="No passkey enrolled")
    challenge = secrets.token_bytes(32)
    row = _store_challenge(session, challenge, "authenticate", user.id)
    options = {
        "challenge": _b64url_encode(challenge),
        "timeout": 60000,
        "rpId": relying_party_id(request),
        "allowCredentials": [{"type": "public-key", "id": cred.id} for cred in creds],
        "userVerification": "required",
    }
    return {"challenge_id": row.id, "options": options}


def authentication_complete(session: Session, request: Request, challenge_id: str, credential: dict) -> User:
    row = _load_challenge(session, challenge_id, "authenticate")
    raw_id = credential.get("rawId") or credential.get("id")
    if not isinstance(raw_id, str) or not raw_id:
        raise HTTPException(status_code=400, detail="Passkey credential is missing an id")
    cred = session.get(PasskeyCredential, raw_id)
    if cred is None:
        try:
            cred = session.get(PasskeyCredential, _b64url_encode(_b64url_decode(raw_id)))
        except Exception:
            cred = None
    if cred is None or (row.user_id and cred.user_id != row.user_id):
        raise HTTPException(status_code=401, detail="Invalid passkey")
    user = session.get(User, cred.user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="Invalid passkey")
    client_bytes = _parse_client_data(
        credential, "webauthn.get", _b64url_decode(row.challenge), expected_origin(request)
    )
    response = credential.get("response")
    if not isinstance(response, dict):
        raise HTTPException(status_code=401, detail="Passkey authentication failed")
    try:
        authenticator_data = _b64url_decode(str(response.get("authenticatorData") or ""))
        signature = _b64url_decode(str(response.get("signature") or ""))
        public_key = _b64url_decode(cred.public_key)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Passkey authentication failed") from exc
    _verify_assertion(public_key, authenticator_data, client_bytes, signature)
    if len(authenticator_data) >= 37:
        cred.sign_count = int.from_bytes(authenticator_data[33:37], "big")
        session.add(cred)
    session.delete(row)
    session.commit()
    return user
