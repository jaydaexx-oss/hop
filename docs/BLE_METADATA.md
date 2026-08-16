# BLE metadata observer surface (Phase 2)

HOP Nearby uses GATT over a custom service (`8e7a0001-6f70-48a1-9c3d-2b1e0a7c5d11`). Message **bodies** are libsodium `crypto_box` payloads. This document lists what a passive radio observer can still learn. It is **not** a claim of BLE hardware success; Nearby has not been proven on physical phones in this repository.

## Advertisements (intentionally plaintext)

Advertisements must remain discoverable. They are **not** encrypted.

| Field | Observer learns |
|---|---|
| Service UUID | That a HOP Nearby device is present |
| Local name `HOP:{username}` | Approximate username (truncated by platform name limits) |
| RSSI / timing | Rough proximity and when Nearby is in the foreground |
| Hardware identifiers | Android may expose a MAC-like `deviceId` to the scanning OS; the app must not show it in UI |

iOS typically randomizes the Bluetooth address. Android behavior depends on API level and permissions.

## GATT handshake characteristic (plaintext JSON, v2)

`encodeHandshake` writes `{ v: 2, user_id, username, pk }` as UTF-8 hex on `HOP_BLE_HANDSHAKE_UUID` (read).

A connected observer (or a malicious central that connects) can learn:

- HOP user id
- username
- long-term identity **public** key

They cannot read the identity **secret** key from this characteristic. Phase 2 does **not** encrypt the handshake (size/MTU and discoverability). Mitigations that **are** in place:

- Handshake `pk` is checked against the server-published identity when online (`resolveServerPublicKey`)
- Persistent TOFU binds `user_id → pk`. A later different `pk` becomes `KEY_CHANGED` and is not auto-trusted
- Encrypt/decrypt to `KEY_CHANGED` peers is refused until an explicit `acceptChangedKey`

A first-contact impersonator can still bind a victim who has never seen that user id (classic TOFU). That is not Signal-level identity.

## Inbox writes (ciphertext + envelope metadata)

Inbox frames are JSON envelopes. `encrypted_payload` is a crypto_box. Envelope fields (`message_id`, `sender_id`, `recipient_id`, `conversation_id`, timestamps, ttl, hop_count, transport) are **not** sealed. An observer who can see GATT writes learns who is talking to whom and which `message_id` is in flight, but not the text/audio.

## GATT ACK notify (Phase 2: authenticated)

Phase 1 notified UTF-8 `message_id`. That leaked the id and could be forged.

Phase 2 notifies an authenticated JSON MAC (`hop-ble-ack-v1`) over `{ message_id, from, nonce }` using `crypto_auth` with a key derived from `crypto_box_beforenm` of the two long-term identities. Forged or plaintext ACKs are rejected. Replay of a GATT ACK for a message that is not pending is ignored.

A radio observer can still see **that an ACK happened** and the ciphertext-sized notify payload; they should not be able to forge a success that the sender will accept.

## What this is not

- Not handshake encryption or an authenticated handshake transcript
- Not BLE advertisement encryption
- Not forward secrecy
- Not proof that two phones completed a session
