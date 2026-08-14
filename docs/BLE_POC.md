# BLE proof of concept

Status: **implemented in code, not verified on physical devices.** Simulator, Expo Go, and web do not count.

Mesh / multi-hop relay is **not** implemented. Incoming BLE envelopes with `hop_count > 0` are dropped so this phone cannot act as a relay.

## Milestone

```text
Device A
   ↓ BLE (secure session + libsodium crypto_box)
Device B
```

Two physical HOP phones, one hop, no mesh. Direct GATT only.

Chat send uses the same BLE path automatically when internet is down and this recipient is nearby. The user does not pick a transport.

## Cryptography (established primitives only)

HOP does not invent a protocol. Nearby uses **libsodium `crypto_box`** (NaCl box):

| Piece | Primitive |
|---|---|
| Identity keys | `crypto_box_keypair` (X25519) |
| Session | GATT connect + read peer `pk` from handshake |
| Confidentiality | XSalsa20 (`crypto_box_easy`) |
| Auth / integrity | Poly1305 MAC (same `crypto_box` construction) |
| Nonce | `randombytes_buf(crypto_box_NONCEBYTES)` per message |

This is **not** Signal Protocol and **not** a forward-secret ratchet. Each application message is sealed to the peer’s long-term `crypto_box` public key. `crypto_kx` is unused (the JS wrapper used here does not expose it; `crypto_box` is the established NaCl API).

Internet chat is still `alg: none`. Only the Nearby BLE path encrypts.

Empty plaintext is refused. BLE also refuses `alg: none` and any payload that is not `crypto_box_xsalsa20poly1305`.

### Handshake (v2)

```json
{ "v": 2, "user_id": "…", "username": "alice", "pk": "<base64 crypto_box public key>" }
```

Connect fails if the peer does not publish `pk`. The Nearby row then shows **Secure session**.

The connecting phone (GATT central) reads the peer’s `pk`. The receiving phone (GATT peripheral) opens `crypto_box` with `sender_pk` from the payload; it only binds that key to a handshake when it has previously connected to the sender as central.

### Encrypted payload

Outer GATT envelope is a HOP envelope (`message_id`, routing fields, `encrypted_payload`). Inner authenticated plaintext (inside `crypto_box`) is:

```json
{
  "message_id": "…",
  "sender_id": "…",
  "recipient_id": "…",
  "conversation_id": "…",
  "text": "…",
  "created_at": "…",
  "expires_at": "…",
  "ttl": 0,
  "hop_count": 0
}
```

Outer JSON:

```json
{
  "v": 1,
  "alg": "crypto_box_xsalsa20poly1305",
  "sender_pk": "…",
  "nonce": "…",
  "ciphertext": "…"
}
```

Decrypt requires:

1. Poly1305 verification (`crypto_box_open_easy`)
2. `sender_pk` matches the handshake key when the peer is known
3. Inner `message_id` equals the envelope `message_id`

Ack is sent **only after** decrypt succeeds (or the `message_id` is a known duplicate). Failed auth → no ack → sender retries.

## Delivery, timeout, retry, duplicates

| Control | Behavior |
|---|---|
| Message ID | CSPRNG UUID v4 on the envelope and inside the box |
| Ack | GATT notify of `message_id` after successful decrypt |
| Timeout | Connect 15s; ack wait 8s per attempt |
| Retry | 3 attempts, backoff 1s then 2s (`sendWithAckRetry`) |
| Duplicates | In-memory `ProcessedIdSet`; duplicates still ack so the sender can stop |

## GATT

| Role | UUID |
|---|---|
| Service | `8e7a0001-6f70-48a1-9c3d-2b1e0a7c5d11` |
| Handshake (read) | `8e7a0002-…d11` — v2 JSON with `pk` |
| Inbox (write, chunked) | `8e7a0003-…d11` — `HOP1` frames |
| Ack (notify) | `8e7a0004-…d11` — `message_id` |

Nearby advertises the local name `HOP:<username>` (truncated) plus the service UUID. The UI shows the handshake/advertised **display name**, never a Bluetooth MAC.

Identity keypair is stored per user in SecureStore (`hop.box.<userId>`).

## Scan / advertise policy

- Nearby screen focused: advertise (if the OS allows it) and **balanced** scan in 12s on / 8s off pulses
- Nearby left, or app backgrounded: stop scan, stop advertising, disconnect
- Default is not `lowLatency` continuous scanning

## Pass criteria (physical devices only)

None of these have been run in this environment.

| Test | Pass |
|---|---|
| Discovery | Peer shown as a display name on Nearby, not a MAC |
| Session | Connect → **Secure session** (handshake `pk` present) |
| Send | Encrypted message arrives; peer log shows authenticated plaintext |
| Integrity | Tampered ciphertext is dropped; sender gets no ack |
| Duplicate | Same `message_id` processed once; retry still acked |
| Timeout / retry | Missing ack retries up to 3 times |
| Internet off | Still delivers over BLE |

See `BLE_TESTING.md` for exact two-phone steps and `PLATFORM_LIMITATIONS.md` for OS constraints.
