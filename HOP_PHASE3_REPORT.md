# HOP Phase 3 Production Stabilization Report

**Branch:** `integration/production-stabilization`  
**Date:** 2026-08-16  
**Crypto:** libsodium `crypto_box` (X25519 + XSalsa20-Poly1305) is unchanged. No ratchet. No Signal-level claims.  
**BLE hardware:** still **UNVERIFIED**. This phase did not run radios and does not claim BLE works on phones.

Phase 3 stops here pending approval. This branch was pushed to origin only. It was **not** merged to `dev` or `main`. Legacy branches were not touched. Phase 1 and Phase 2 security hardening is preserved (identity fail-closed, TOFU `KEY_CHANGED`, authenticated `delivery_ack`, `sendGuards`, ephemeral voice cache, `__DEV__` diagnostics).

Forward secrecy remains a documented future milestone (`docs/FORWARD_SECRECY_DESIGN.md`). No new crypto protocol was invented.

---

## A. Changes made

### Demo / prototype inventory (active app path)

| Item | Found | Action |
|---|---|---|
| `SimulatedNetwork` | Protocol test helper only | **Unchanged.** Not imported by `apps/mobile`. |
| `createRelayTransport` | Registered by `createAppTransportManager` | **Removed from the mobile app TM.** Still in the protocol package / `defaultTransportManager()` for tests. `LIVE_TRANSPORT_PRIORITY` remains `internet`, `bluetooth`. |
| Nearby `sendTestPayload` | `__DEV__`-gated, unused by Nearby UI | **Kept `__DEV__`.** Production CTA is Message → `openOrCreatePeerConversation` → Chat → `MessageService`. |
| PTT `Math.random()` bars | Fake metering | **Replaced** with a labeled decorative pulse: “recording (not a mic meter)”. HOLD TO HOP kept. |
| Voice bubble hard-coded bars | Looked like a waveform | **Replaced** with a playback progress track. Not audio metering. |
| Chat preview “Tap to open” | Already replaced by transport line in Phase 1 merge | **Improved:** last decrypted caption via `conversationPreviewLine`. Null text → “Encrypted message”. Ciphertext is never shown. |
| `PlaceholderScreen` | Unused | **Kept isolated.** |
| API 501 stubs (`/push`, `/devices`, `/sync`) | Isolated in Phase 1 | **Unchanged.** Tests still expect 501. |
| `postEnvelope` → `POST /messages` | Dead client helper, no such API route | **Deleted.** |
| `encodeUnencryptedText` / `alg: none` | Protocol test helper; not exported to app send | **Unchanged.** Production send still refuses. |
| LocalTransport detail | “SQLite persistence is not implemented” | **Copy fixed.** Durable queue is `HopSqliteStore`. TM local class is in-memory only. |
| Device diagnostics / BLE debug | `__DEV__` gated | **Kept.** |
| Voice cache `Math.random()` | Filename uniqueness | **Left.** Not metering. |

### Messaging reliability

- Transport selection remains **TransportManager only**. Chat and Nearby production send go through `sendChat.ts` → `MessageService` → `TransportManager`.
- `TransportManager.send` / `canUse` now catch native/Bluetooth throws and fall through to internet or `{ ok:false, transport:"local" }`. Bluetooth off or permission denied does not crash send.
- Outbound SQLite queue is ordered per conversation (`conversation_id`, `created_at`). Later messages wait while an earlier one is still queued.
- Retry remains bounded exponential backoff (`maxAttempts: 8`, `maxMs: 5 minutes`). Exhaustion → **FAILED**, queue row removed. Regression tests added for text and voice.
- **DELIVERED** still requires an authenticated recipient `delivery_ack` (Phase 2). HTTP `status: DELIVERED` is ignored. Additional Phase 3 regression.
- Duplicate inbound `message_id` still uses durable `processed_ids`. Additional regression.

### PTT / voice

- HOLD TO HOP kept. Same `MessageService` / `crypto_box` / TransportManager path as text. Not live streaming.
- Ephemeral playback files still deleted on end / unmount / error (`VoiceMessageBubble` + `clearVoicePlaybackTemps` on chat unmount).
- Recording file is deleted after encode (success, failure, or too-short abort).
- Mic denial copy: “Microphone access denied. Enable it in Settings to send voice notes.”
- Recording start / encode / send failures surface on the PTT control. MessageService still sets **QUEUED** or **FAILED** honestly; UI shows Retrying when `retry_attempts > 0`.

### Identity / security

- All identity call sites still go through `loadOrCreateIdentity` / `replaceIdentityExplicit`. Production SecureStore failure remains fail-closed. No silent regen.
- Peer fingerprints / `KEY_CHANGED` unchanged.
- No plaintext send fallback. `crypto_box` kept.
- No `console.log` of tokens, keys, or plaintext in `apps/mobile` or `apps/api` (none found).
- Dead `postEnvelope` removed.

### Production configuration

- `eas.json`: `preview` and `production` profiles with `developmentClient: false`. `development` still uses the dev client for local/device work.
- `app.json` `extra.requiresHttpsApiInRelease: true`.
- Release clients (`!__DEV__`): `EXPO_PUBLIC_API_URL` is required; localhost/loopback refused; cleartext HTTP refused unless `EXPO_PUBLIC_ALLOW_CLEARTEXT_HTTP=1` (staging, still never localhost).
- Local/dev unchanged: Metro `__DEV__` still defaults to `http://127.0.0.1:8000` and allows RFC1918 LAN HTTP for physical phones on the same Wi-Fi.
- API production startup refuses `CORS_ORIGINS=*` / empty, missing `DATABASE_URL` / `REDIS_URL`, and `CHANGE_ME` or the localhost Postgres default. Development still uses local defaults.

### Error handling / UX

- Banner: Offline, Nearby, Online, Queued, **Reconnecting** (was Synchronizing).
- Bubbles: Queued, Sending, Sent, Delivered, Failed, **Retrying**.
- Nearby copy: Bluetooth off / permission denied does not block internet chat or the offline queue.
- Chat does not lock a transport; header follows TransportManager availability.

---

## B. Tests and exact results

| Suite | Command | Result |
|---|---|---|
| Protocol | `cd packages/protocol && npm test -- --run` | **131 passed**, 0 failed (20 files) |
| API | `cd apps/api && .venv/bin/pytest` | **40 passed**, 0 failed |
| Mobile | `cd apps/mobile && npm run typecheck` | **passed** |
| Mobile lint | — | No lint script in `package.json` |

Phase 2 was 116 protocol + 37 API. New coverage includes: API URL policy, TM Bluetooth-throw fallback, bounded retry → FAILED (text and voice), per-conversation outbound order across restart, conversation preview without ciphertext, HTTP DELIVERED ≠ local DELIVERED, duplicate `processed_ids`, production CORS/secret startup.

No test fakes a physical BLE session. BLE cases still use in-process transports / `MockBleLink`.

---

## C. Remaining blockers

1. **No two-phone BLE proof.** Nearby is still implemented in source and **unverified on hardware**.
2. Identity is still **client-published TOFU**, not attested. First-contact spoofing remains possible. Not Signal.
3. **No forward secrecy.** Compromise of the long-term identity secret decrypts history.
4. Lost identity secret is still a server **409** dead end.
5. EAS preview/production profiles exist, but there is **no EAS `projectId`**, no real TestFlight/App Store build, and no proven HTTPS API deploy in this environment.
6. No push (`/push/register` is 501).
7. No privacy manifest / honest encryption-export declaration in repo.
8. Voice playback still writes an **ephemeral plaintext** temp file for expo-av (deleted after play). Recordings are plaintext until boxed.
9. BLE handshake `user_id` / username / pk remain plaintext GATT (Phase 2 metadata doc).
10. `init_db()` `create_all` still runs in API lifespan (Alembic drift risk).

---

## D. Anything requiring physical phones

Unchanged from the audit. None of these were executed:

- iPhone + Android development builds, mutual Nearby discovery, GATT handshake v2
- Encrypted BLE text/voice in the **same** conversation as internet chat
- Internet-off BLE send; internet-on fallback to `InternetTransport`
- Mic record / speaker play; SecureStore across kill; expo-sqlite queue across kill
- Background: Nearby must stop when the app leaves the foreground

Do **not** treat CI or these unit tests as BLE hardware validation.

---

## E. Revised production-readiness score

**54 / 100** (honest). Phase 1 audit was **38**. Phase 2 was **~46**.

| Delta | Why |
|---|---|
| +4 | Release URL policy + EAS preview/production profiles (packaging prepared, not proven) |
| +3 | Send reliability: bounded retry → FAILED, ordered queue, BLE-throw fallthrough |
| +2 | Demo path cleanup on the active app (relay unregistered, dead `postEnvelope`, honest PTT/preview) |
| +1 | API production fail-closed on CORS `*` / default secrets |
| — | BLE still unverified; no FS; no attested identity; no live HTTPS/TestFlight proof; no push |

A 70+ score still requires two-phone BLE evidence, a real preview/production build against HTTPS, and an identity model beyond client-published TOFU.

---

## F. Exact recommendation for Phase 4

**Do not merge this branch to `origin/dev` or `origin/main` yet.**

Phase 4 should be **physical-device validation + one real preview build**, not more protocol invention:

1. Run `docs/BLE_TESTING.md` on one iPhone + one Android **development client** (`eas.json` `development`). Record pass/fail. Do not mark BLE production-implemented unless both pass.
2. Point a **preview** EAS build (`developmentClient: false`) at a hosted **HTTPS** API with explicit `CORS_ORIGINS` and non-default `DATABASE_URL`. Confirm release URL policy rejects localhost.
3. Soak internet 1:1 chat (queue across kill, crypto delivery receipts, KEY_CHANGED UX) on those phones.
4. Keep forward secrecy, mesh, groups, and push as later milestones.
5. Only after (1)–(3) are recorded, consider merging `integration/production-stabilization` into `dev`.

---

*Phase 3 complete. Waiting for approval before any merge to `dev`.*
