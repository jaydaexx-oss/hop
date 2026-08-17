# Forward secrecy design (not implemented)

**Status:** design only. **Phase 5 choice: option B — defer.** Do not replace `crypto_box`. Do not award forward-secrecy rubric points. A homegrown ratchet is forbidden.

Phase 2–5 keep libsodium `crypto_box_easy` (X25519 + XSalsa20-Poly1305) to the peer’s long-term identity public key. `docs/IDENTITY_TRUST.md` describes TOFU identity; this document describes the future session-key migration only.

## Phase 5 decision (option B, unchanged)

libsodium-wrappers in this repo exposes `crypto_box`, `crypto_auth`, and `crypto_box_beforenm`. It does **not** implement Double Ratchet / X3DH. No libsignal (or other reviewed ratchet) package is installed in `packages/protocol` or `apps/mobile`. Therefore Phase 5 does not add forward secrecy.

| Option | What it is | Phase 5 |
|---|---|---|
| **A** | Adopt a **mature** library (libsignal / a reviewed Double Ratchet implementation) beside today’s identity keys | **Rejected this phase.** Still a product+schema+BLE-MTU migration. |
| **B** | Keep `crypto_box`. Document the exact later migration. Do not invent a mini-ratchet. | **Chosen again.** |

**Do not** implement a custom ratchet, “epoch key”, or hash-chain of `crypto_box` keys. That would be a homemade protocol.

## Current limitation

Every HOP application message (text, voice clip, cryptographic `delivery_ack`) is sealed with libsodium `crypto_box_easy` to the peer’s **long-term** X25519 identity public key (`packages/protocol/src/cryptoBox.ts`). `local_seal` is a self-box of the same plaintext for the sender’s display cache.

If the identity secret in SecureStore is later compromised, an attacker who recorded ciphertext can decrypt **past and future** messages that used that identity. There is no session key, no DH ratchet, and no prekey server.

BLE GATT ACKs use a MAC key derived from the same long-term `crypto_box_beforenm` shared secret. Compromise of either identity secret also forges or verifies those ACKs.

## Exact post-stabilization migration (when option A is picked)

Do this only after production-readiness > 90 **or** as a dedicated crypto milestone with review. Do not mix it into BLE hardware bring-up.

1. **Keep shipping `alg: crypto_box_xsalsa20poly1305`.** Historical rows stay static-key ciphertext. Never “upgrade” them by re-encrypting on the server (the server cannot open boxes).
2. **Add a well-reviewed library** (libsignal or equivalent) as a **new** payload `alg` (working name: `hop_ratchet_v1`). Do not wrap a homemade ratchet in libsodium primitives and call it Signal.
3. **Identity keys stay** the current X25519 `PUT /users/me/identity` keys. Prekeys are a **new** table of **public** material only. Identity 409 immutability stays; ratchet sessions must not require silent identity replacement (`docs/IDENTITY_TRUST.md`).
4. **Server schema:** signed prekeys + one-time prekeys, fetched over HTTPS. No private prekeys on the server.
5. **Client session state** (root/chain/skipped-message keys) lives in fail-closed SecureStore / sealed SQLite, same policy as identity secrets. Offline `MessageService.flushOne` may send much later — skipped-message keys must survive process death.
6. **Hybrid transports:** session state is per peer, not per internet/BLE link. Duplicate `message_id` delivery stays idempotent.
7. **BLE MTU:** ratchet headers inflate frames. Keep chunk limits (`BLE_MAX_*` in `bleCodec.ts`). Do not put session keys in the plaintext handshake; handshake `pk` remains the long-term identity (discoverability + TOFU).
8. **Capability advertise:** both peers must advertise ratchet support (prekey presence or an app version flag) before using `hop_ratchet_v1`. Otherwise stay on `crypto_box`.
9. **QR / safety numbers** verify the **identity** fingerprint (`identityFingerprint`), then optionally the session fingerprint. `markVerified` already exists; no new crypto in the verify UX.
10. **Rollout:** protocol tests with real libsignal first; then two-phone soak; then cut over. Until both sides speak ratchet, `crypto_box` remains the production algorithm.

### Constraints that make a naive port hard

| Constraint | Impact |
|---|---|
| BLE MTU / 18-byte fallback chunks | Ratchet headers + DH public keys inflate every Nearby frame. Chunking already exists; header overhead must stay bounded. |
| Offline queue | `MessageService.flushOne` may send much later. Skipped-message keys and out-of-order delivery must survive process death (sql.js/SQLite), not RAM. |
| Hybrid internet + BLE | The same conversation can move between transports. Session state is per peer, not per transport. Duplicate `message_id` delivery must stay idempotent. |
| No prekey distribution today | Offline first-message to a never-seen peer cannot complete X3DH without prekeys or a QR bootstrap. |
| Identity 409 immutability | Rotation of long-term identity is intentionally blocked. A ratchet migration must not require silent identity replacement. |
| Voice clips ≤ 8s / 64KiB API cap | Extra ratchet headers compete with `audio_b64` budget. |

## Explicit non-goals (Phase 5 and earlier)

- No replacement of `crypto_box`
- No custom “mini-ratchet”
- No cloud backup of identity secrets (would undermine any later FS story unless the backup is itself reviewed)
- No claim of Signal-level security
- No forward-secrecy points on the production-readiness rubric until a mature library is implemented **and** tested
