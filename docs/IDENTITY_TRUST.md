# Identity trust model

HOP identity is **client-published TOFU**, not attestation. This document states what the server and clients can and cannot prove. It is not a Signal security model.

## What the server authenticates

| Claim | Server can prove? |
|---|---|
| The request bearer holds a valid session token for a user id | **Yes** (opaque session, 30-day expiry) |
| That user published **this** X25519 public key | **Yes**, after `PUT /users/me/identity` |
| The publisher still holds the matching secret | **No** (server never sees secrets) |
| The key belongs to a human / device / app install | **No** |
| First-contact authenticity (no impersonator) | **No** |
| Forward secrecy / compromise of the long-term secret | **No** |

`PUT /users/me/identity` accepts `{ public_key }` only (`extra=forbid`). A body with `secret_key` is 422. The first successful publish is sticky: a **different** key returns **409 `SERVER_KEY_LOCKED`**. The same key is idempotent (200). The server never silently substitutes a key.

## What the client authenticates

| Claim | Client can prove? |
|---|---|
| Local secret still opens boxes sealed to the published pk | **Yes**, after load |
| Peer pk is the same one first stored (TOFU) | **Yes**, persisted in SQLite `peer_identities` |
| Peer pk is the same as `GET /users/id/{id}` | **Yes**, if the API is reachable |
| Out-of-band verification (QR / safety number) | **Structured only** (`markVerified`, fingerprint helpers) — no Settings UI yet |

TOFU states: `UNKNOWN` → `TOFU_TRUSTED` on first seen pk → `VERIFIED` only via explicit `markVerified` → `KEY_CHANGED` if a different pk appears. `KEY_CHANGED` does **not** overwrite the stored fingerprint and **refuses encrypt/send**.

## Client identity errors (no silent regen)

| Code | Meaning | Recovery |
|---|---|---|
| `IDENTITY_INACCESSIBLE` | Durable marker exists; secret missing or corrupt | Explicit Settings **Replace local identity keys**. That cannot publish a second server key. |
| `KEY_MISMATCH` | Local pk ≠ server-published pk | Do **not** PUT. Re-verify after an explicit local replace, or use a new account. |
| `SERVER_KEY_LOCKED` | Server 409: a different pk is already published | **New account.** Unauthenticated replacement is forbidden. |
| `SECRET_STORE_UNAVAILABLE` | Production SecureStore failed closed | Fix Keychain/Keystore; do not fall back to RAM. |

Matching local secret + matching published pk is the only silent-OK path. `publishIdentityIfAllowed` never PUTs on mismatch.

## Fingerprints (display only)

`formatPersistedFingerprint` / `identityFingerprint` format the **already persisted** public key for later QR/safety-number UI. They do **not** attest the key. Showing a fingerprint is not proof against first-contact spoofing.

## Rotation (not implemented this phase)

A safe rotation API **must** prove possession of the current secret (for X25519: a DH challenge-response against an ephemeral server key, or an Ed25519 identity added later). Unauthenticated “replace my pk” would let an attacker lock a victim out.

Until that exists, lost secrets are a **new account**. Local `replaceIdentityExplicit` only rotates the device copy.

## BLE handshake

Advertisements and the first GATT handshake (`user_id`, username, pk, optional session nonce) are **plaintext** for discoverability. After a pk is TOFU-bound, a changed handshake pk is `KEY_CHANGED` and send is refused. A handshake nonce rejects replays of the same `(user_id, n)` pair. This is **not** an authenticated first packet.
