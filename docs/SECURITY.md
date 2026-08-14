# HOP security

Security is a core requirement. **Do not invent cryptographic protocols.**

E2EE is **not implemented**. This file is the target design plus the threat model.

## Threat model

| Threat | Intent | Direction |
|---|---|---|
| Man-in-the-middle | Swap keys, read or alter traffic | TOFU + out-of-band verify (QR / safety number); TLS for internet |
| Replay | Resend a captured envelope | `message_id` uniqueness, processed-ID set, `expires_at` |
| Device impersonation | Pretend to be another user | Identity keys; device list; verification |
| Malicious relays | Read or tamper while forwarding | Relays see ciphertext only; AEAD detects tamper; hop/TTL limits |
| Packet injection | Inject GATT/WS frames | Authenticated encryption; reject unauthenticated envelopes |
| Spam | Flood Nearby or the API | Rate limits, block list, relay opt-in |
| Denial of service | Drain battery / flood queue | Scan duty cycle, max queue, max hops, backoff cap |
| Metadata leakage | Learn who talks to whom | Minimize server fields; no MAC/GPS in UI or logs; careful advertisements |
| Compromised device | Attacker has the phone | Session revoke; later: remote logout; cannot un-send already delivered plaintext |
| Lost device | Phone stolen | Keychain/Keystore; lock-screen; later: device removal |

Out of scope for v1 (still design so we do not paint into a corner): formal anonymity set, mixnets, sealed-sender at Signal’s level.

## Crypto plan

### Phase 1 — PoC / first BLE (not started)

Use **libsodium** (established): X25519 key agreement + XChaCha20-Poly1305 AEAD.

- Encrypt **before** `TransportManager.enqueue`
- `TransportManager` already refuses empty `encrypted_payload`
- Never send plaintext over BLE, Internet, or relay

This is **not** production messenger E2EE (no ratcheting / limited forward secrecy).

### Phase 2 — Production

Evaluate a mature audited protocol, preferably **Signal Protocol** via `libsignal` (or another audited equivalent). Separate:

1. Identity keys  
2. Session establishment  
3. Message encryption  
4. Authentication  
5. Key rotation  
6. Device verification (safety number / QR)

Do not ship a homegrown ratchet.

### Key storage

| Secret | Where | Not where |
|---|---|---|
| Identity private key | iOS Keychain / Android Keystore | SQLite, UserDefaults, logs |
| Session keys | Secure storage | Server |
| Auth token | Secure storage | Git, plaintext DB |

Server stores **public** identity keys only.

## Authentication and devices

- Sessions: store **token hashes**, not raw tokens (table exists; logic does not)
- One user, many devices; each device has its own identity key
- Lost device: user can drop it from Settings once that UI exists

## Relay consent

```text
Help relay encrypted messages    ON / OFF
```

Default **OFF** until product decides otherwise. A relay:

- May store-and-forward an opaque envelope until TTL/hops expire
- Must not decrypt
- Must not log payload bytes
- Must drop duplicates

## Privacy policy constraints (product)

- Do not sell message data
- Do not use private messages for advertising
- Do not upload the full contact list without explicit consent
- Nearby must not show Bluetooth MAC, precise GPS, or extra device identifiers
- Collect the minimum of location, contacts, device ids, and message metadata

## Replay and duplicates

Every device keeps a processed `message_id` set.

- If seen → discard, do not forward  
- RAM-only set (current skeleton) is **insufficient** for production — must persist in SQLite (see roadmap M3)

## Internet path

- TLS for API and WebSockets
- Rate-limit auth, message submit, and sync
- No plaintext body column on `messages`

## BLE path

- Same envelopes as internet (ciphertext)
- Advertisement: rotating peer token + display name, not MAC, not user id if avoidable
- Chunking is not encryption; encrypt first, then chunk
- Details: [BLE.md](./BLE.md)

## Platform notes that affect security

- iOS Keychain items may be inaccessible when the device is locked — queue crypto, do not crash
- Android Keystore / StrongBox availability varies by device
- Screenshot / notification previews can leak message text on-device (UI later: hide previews in lock screen)
- Backup: decide whether iCloud/Google backup includes keys (default: **exclude** private keys)

## Status

| Control | Status |
|---|---|
| Threat model | Specified |
| Empty-payload reject | Implemented, tested |
| Duplicate ID drop | Implemented in memory, tested |
| TTL / hop stop | Implemented, tested |
| TLS / auth / E2EE / Keychain | **Not implemented** |
| Signal Protocol | **Not implemented** |
