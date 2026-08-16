# HOP Phase 2 Security Report

**Branch:** `integration/production-stabilization`  
**Date:** 2026-08-16  
**Crypto:** libsodium `crypto_box` (X25519 + XSalsa20-Poly1305) is unchanged. No ratchet. No Signal-level claims. No BLE hardware proof.

Phase 2 stops here pending approval. This branch was pushed to origin only. It was **not** merged to `dev` or `main`. Legacy branches were not touched.

---

## 1. Exact issues fixed

### Priority A — Identity key storage
- Production SecureStore failure **fails closed**. Volatile `Map` fallback is disabled when `__DEV__ === false` or `NODE_ENV === production`. Secrets are not copied into RAM as a “success” path.
- Durable identity marker (`hop.box.marker.{userId}`) is stored separately from the secret. If the marker exists and the secret is missing or corrupt, HOP throws `IDENTITY_INACCESSIBLE` and **does not** generate a replacement pair.
- After load, the client compares local `publicKey` to `GET /users/me`. A different server key is `KEY_MISMATCH`; the client does not PUT a new key over a 409.
- `PUT /users/me/identity` body is `{ public_key }` only (`identityPublishBody`). API `IdentityIn` uses `extra="forbid"` so a `secret_key` field is 422.
- Device-local recovery is an explicit Settings action (`replaceIdentityExplicit`). No cloud private-key backup.

### Priority B — Peer identity verification
- `PublicKeyTofu` now has states `UNKNOWN | TOFU_TRUSTED | VERIFIED | KEY_CHANGED`, a persistence adapter, and SQLite `peer_identities` (fingerprints only).
- First seen pk → `TOFU_TRUSTED` (persisted). Same pk stays trusted/verified. Different pk → `KEY_CHANGED`, stored fingerprint is **not** overwritten, new key is **not** auto-trusted.
- `markVerified` exists for a later QR/safety-number UX. `acceptChangedKey` is explicit only.
- Encrypt (internet `OfflineProvider` + BLE `HopBleEngine.send`) throws/refuses on `KEY_CHANGED`. Decrypt `tofu.bind` still rejects a changed sender pk. Conversation `peer_public_key` updates go through `observe()`.

### Priority C — Cryptographic delivery ACK
- Recipient sends a normal crypto_box `kind: "delivery_ack"` (`ack_of`, conversation/sender/recipient ids, `ack_status: DELIVERED`, timestamps) to the original sender’s pk via `MessageService` / TransportManager.
- `MessageService`: transport OK → **SENT**. **DELIVERED** only after a decrypted, validated ack. Server HTTP `status: DELIVERED` is ignored.
- API `send_message` always stores **SENT**. Websocket presence no longer fabricates DELIVERED.
- Forged acks (wrong keys / tofu / ids) are rejected. Replayed ack `message_id` is rejected via `processed_ids`.
- BLE `delivery_ack` envelopes go through `acceptInbound` (same validation), not a raw `applyDeliveryAck(id)` shortcut.
- Crypto **READ** receipts are not sent. Chat no longer POSTs HTTP `/acks` as fake READ.

### Priority D — BLE metadata
- Observer surface documented in `docs/BLE_METADATA.md`. Advertisements stay plaintext (discoverability).
- GATT ACK is no longer UTF-8 `message_id`. It is a `crypto_auth` MAC over `{message_id, from, nonce}` keyed from `crypto_box_beforenm`. Forged/plaintext ACKs are rejected. Handshake remains plaintext JSON, still bound by server identity check + persistent TOFU.

### Priority E — Forward secrecy
- **Not implemented.** Design only: `docs/FORWARD_SECRECY_DESIGN.md`. `crypto_box` was not replaced.

---

## 2. Issues intentionally deferred

- Forward secrecy / Double Ratchet / any custom ratchet
- Cloud backup of identity secrets (would need a reviewed security model first; not started)
- QR / safety-number verification UX (`markVerified` is structured only)
- Encrypting the BLE handshake transcript (observer can still see `user_id`, username, pk)
- Server-side identity rotation after 409 (explicit local replace still cannot publish a second pk)
- Crypto READ receipts
- Removing the HTTP `/messages/{id}/acks` bookkeeping endpoint (it is no longer the UI source of truth)
- Push, groups, mesh, production EAS, attested identity/CA
- Two-phone BLE hardware proof
- Voice plaintext playback cache from Phase 1

---

## 3. Security architecture changes

| Area | Before | After |
|---|---|---|
| Identity secret | SecureStore with RAM fallback | Production fail-closed; marker + no silent regen |
| Identity publish | Best-effort PUT; swallow 409 | Compare to `api.me`; KEY_MISMATCH; PUT only if server empty |
| Peer trust | RAM TOFU boolean | Persisted states including KEY_CHANGED |
| Delivery | Server WS connected → DELIVERED | Opaque ciphertext stored as SENT; client DELIVERED from crypto ack |
| BLE ACK | UTF-8 message_id notify | Authenticated MAC; unauthenticated rejected |
| FS | Static crypto_box | Still static crypto_box; design doc only |

Private identity keys still never belong on the server. They must not appear in API payloads; Phase 2 adds a typed publish body and a schema forbid.

---

## 4. Tests added

Protocol:
- `identityLifecycle.test.ts` — publish body has no secret; no silent regen; KEY_MISMATCH; fail-closed SecureStore policy
- `tofu.test.ts` — KEY_CHANGED, no auto-trust, persist/hydrate, `markVerified`
- `bleAck.test.ts` — valid MAC accepted; forged and plaintext GATT ACKs rejected
- `phase2Security.test.ts` — HTTP DELIVERED ≠ local DELIVERED; valid ack → DELIVERED; forged ack rejected; replay rejected; KEY_CHANGED not encrypted to; existing text box still opens

API:
- `test_identity_put_rejects_secret_key_field`
- Websocket send now expects `SENT` even if the peer is connected
- Existing HTTP `/acks` test remains (server bookkeeping only)

Existing Phase 1 invariants (encrypted text, encrypted PTT, offline queue) still run in `productionStabilization.test.ts`, `voice.test.ts`, `offlineSync.test.ts`.

---

## 5. Total tests passed / failed

| Suite | Result |
|---|---|
| `packages/protocol` `npm test` | **116 passed**, 0 failed (18 files) |
| `apps/api` `pytest` | **37 passed**, 0 failed |
| `apps/mobile` `npm run typecheck` | **passed** |

No mobile unit runner exists in this app; identity/secret-store logic is tested in the protocol package with an injectable backend. Encryption was not weakened for tests.

---

## 6. Breaking schema / API changes

- **`POST /conversations/{id}/messages` always returns `status: SENT`**, including when the recipient websocket is connected. Clients that treated HTTP 200 + `DELIVERED` as cryptographic delivery will now show Sent until a crypto ack arrives.
- **`PUT /users/me/identity` rejects unknown fields** (`extra=forbid`). A body with `secret_key` is 422.
- No database migration beyond client SQLite `peer_identities` (created on store init). Server message schema is unchanged (opaque ciphertext).
- `ApplicationPlaintext` gained `ack_status?: "DELIVERED" | "READ"`. Old `delivery_ack` boxes without `ack_status` still decrypt; MessageService treats missing status as DELIVERED when applying.

---

## 7. Remaining P0

1. **No two-phone BLE proof.** Nearby is still **IMPLEMENTED BUT UNVERIFIED ON HARDWARE**.
2. **Identity is still client-published TOFU**, not attested. First-contact spoofing remains possible. Not Signal.
3. **Compromise of the long-term identity secret decrypts history.** No forward secrecy.
4. **Lost identity secret is still a dead end on the server** (409). Explicit local replace cannot publish a new pk. No reviewed recovery protocol.
5. **No production mobile pipeline** (EAS development-only, localhost API default).

---

## 8. Remaining P1

- BLE handshake `user_id` / username / pk still plaintext GATT
- Envelope metadata (ids, timestamps) still visible beside ciphertext (internet and BLE)
- HTTP `/acks` can still change **server** status; honest clients ignore it for crypto UI
- Voice decrypted playback cache on disk (Phase 1)
- No push (501)
- No QR verify UX
- Rate limits still in-process if Redis is down
- Server stores rich metadata (ids, times, status, ciphertext)

---

## 9. Safe for physical-device testing?

**Yes, with a narrow meaning:** this branch is safer to put on development-build phones than Phase 1 for identity and delivery-status honesty. Production builds will not silently mint a new identity into RAM if Keychain fails. Peer key changes will not be auto-trusted. Delivery will not jump to Delivered because the API said so.

**No, with the product meaning:** this is **not** evidence that BLE works between two phones, that E2EE is Signal-grade, or that the app is store-ready. Physical tests in `HOP_PRODUCTION_AUDIT.md` remain required. Do not ship.

---

## 10. Updated production-readiness estimate

Audit Phase 1 score was **38 / 100**.

Phase 2 is roughly **46 / 100**. The identity fail-closed path, persistent TOFU, and cryptographic delivery receipts are real code with tests. The score does not jump further because the product bar is still a hybrid messenger: BLE unverified, no FS, no attested identity, no production EAS/HTTPS proof, no push.

A 70+ score still requires two-phone BLE evidence, production packaging, and an identity model beyond client-published TOFU.

---

*Phase 2 complete. Waiting for approval before any merge to `dev`.*
