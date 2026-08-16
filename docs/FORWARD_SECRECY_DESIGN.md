# Forward secrecy design (not implemented)

**Status:** design only. Phase 2 does **not** replace `crypto_box`, does **not** add a Double Ratchet, and does **not** claim forward secrecy.

## Current limitation

Every HOP application message (text, voice clip, cryptographic `delivery_ack`) is sealed with libsodium `crypto_box_easy` to the peer’s **long-term** X25519 identity public key (`packages/protocol/src/cryptoBox.ts`). `local_seal` is a self-box of the same plaintext for the sender’s display cache.

If the identity secret in SecureStore is later compromised, an attacker who recorded ciphertext can decrypt **past and future** messages that used that identity. There is no session key, no DH ratchet, and no prekey server.

BLE GATT ACKs use a MAC key derived from the same long-term `crypto_box_beforenm` shared secret. Compromise of either identity secret also forges or verifies those ACKs.

## Why not invent a custom ratchet this phase

A homegrown ratchet would be a new cryptographic protocol. HOP should not ship one without a review comparable to Signal’s. Keeping `crypto_box` for this phase is a deliberate constraint.

## Signal-style sessions for HOP (evaluation)

A later migration could introduce X3DH + Double Ratchet (or a well-reviewed library such as libsignal) **alongside** today’s identity keys:

1. **Identity** remains the long-term X25519 key (already published via `PUT /users/me/identity` and BLE handshake `pk`).
2. **Signed prekeys / one-time prekeys** would need a server that stores **public** prekeys only. The current API stores one immutable identity public key per user and opaque message ciphertext. Prekeys are a new schema.
3. **Session state** (root key, chain keys, skipped-message keys) must live in SecureStore or an encrypted DB, fail-closed like identity secrets. SQLite currently holds ciphertext, not session keys.
4. **Each message** would wrap `ApplicationPlaintext` in a ratchet payload instead of (or inside) `crypto_box`. Recipients without a session still need a bootstrap path.

### Constraints that make a naive port hard

| Constraint | Impact |
|---|---|
| BLE MTU / 18-byte fallback chunks | Ratchet headers + DH public keys inflate every Nearby frame. Chunking already exists; header overhead must stay bounded. |
| Offline queue | `MessageService.flushOne` may send much later. Skipped-message keys and out-of-order delivery must survive process death (sql.js/SQLite), not RAM. |
| Hybrid internet + BLE | The same conversation can move between transports. Session state is per peer, not per transport. Duplicate `message_id` delivery must stay idempotent. |
| No prekey distribution today | Offline first-message to a never-seen peer cannot complete X3DH without prekeys or a QR bootstrap. |
| Identity 409 immutability | Rotation of long-term identity is intentionally blocked. A ratchet migration must not require silent identity replacement. |
| Voice clips ≤ 8s / 64KiB API cap | Extra ratchet headers compete with `audio_b64` budget. |

### Migration sketch (future work)

- Keep `alg: crypto_box_xsalsa20poly1305` working until both peers advertise `alg: hop_ratchet_v1` (or similar).
- Do not decrypt historical crypto_box rows with a new ratchet; they stay static-key ciphertext.
- New sessions: X3DH using published identity + prekeys; then Double Ratchet for each 1:1 conversation.
- BLE handshake can keep advertising the long-term `pk` (discoverability) while session keys stay off-air except as ratchet headers inside inbox frames.
- QR / safety numbers should verify the **identity** key (and later the session fingerprint), which Phase 2 only **structures** (`markVerified`) without UX.

## Explicit non-goals for Phase 2

- No replacement of `crypto_box`
- No custom “mini-ratchet”
- No cloud backup of identity secrets (would undermine any later FS story unless the backup is itself reviewed)
- No claim of Signal-level security
