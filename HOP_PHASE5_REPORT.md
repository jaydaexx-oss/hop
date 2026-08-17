# HOP Phase 5 Production Stabilization Report

**Branch:** `integration/production-stabilization`  
**Date:** 2026-08-16  
**Crypto:** libsodium `crypto_box` / `crypto_auth` / `crypto_box_beforenm` only. **Forward secrecy: option B (defer).** No ratchet. No Signal-level claims.  
**BLE hardware:** still **UNVERIFIED**. Handshake authentication is proven in-process. This phase does not claim radios work on phones.

Phase 5 stops here pending approval. This branch is pushed to origin only. It is **not** merged to `dev` or `main`. Legacy branches were not touched. Phase 1–4 hardening is preserved.

---

## 1. Scope

Stabilization-only work on this branch: identity adversarial tests, authenticated BLE handshake, PTT temp-file lifetime, npm audit honesty, push-not-offered, chaos tests, observability, and a software release gate. No Event Mode, mesh, group PTT, live calls, social, or monetization.

## 2. Identity adversarial tests and fixes

Automated protocol + API tests now prove:

- Server cannot silently replace a published key (**409 `SERVER_KEY_LOCKED`**; matching PUT is idempotent).
- Changed peer key → client **KEY_CHANGED**; stored fingerprint is not overwritten; encrypt/send refused.
- Trusted fingerprint survives SQLite restart (`HopSqliteStore` + sql.js file).
- Identity loss fails closed (`IDENTITY_INACCESSIBLE`); lost secret does not silent-regen.
- Malformed public keys rejected (API 400/422; client `publishIdentityIfAllowed`).
- Cross-account key substitution rejected (API 409 if another account already published the pk; TOFU will not bind a pk already trusted for a different user).
- Duplicate username is 409 (`IntegrityError` race mapped). Rollback of an unpublished second key leaves the original.
- Unauthenticated identity PUT is 401. Extra `secret_key` field remains 422.

`SERVER_KEY_LOCKED` remains honest: there is still **no unauthenticated rotation**.

## 3. Authenticated BLE handshake

GATT advertisements stay discoverable (local name). The first handshake **read** may still expose pk (documented TOFU). Session establishment requires v3 `auth = crypto_auth(transcript, key)` where `key` is `crypto_generichash(crypto_box_beforenm(local_sk, peer_pk))`. Transcript binds both pks, user_id, username, nonce, and timestamp.

Protocol tests (no radio): mutual possession, replay, stale timestamp, malformed, v1/v2 downgrade, KEY_CHANGED refuse, wrong-secret MAC, `peer_pk` binding. `HopBleEngine` writes/verifies the authenticated characteristic after the announcement read. Missing `auth` is rejected. This is **not** two-phone radio proof.

## 4. Forward secrecy

Re-read `docs/FORWARD_SECRECY_DESIGN.md`. libsodium-wrappers cannot do Double Ratchet. No libsignal (or other reviewed ratchet) is installed. **Option B kept.** No homemade ratchet. **0 FS points.**

## 5. PTT security

Durable store remains ciphertext only. Playback temps use libsodium random filenames (`newEphemeralVoiceFileId`). Leftover `hop-voice*` files are deleted on app start and chat unmount. Recording URI is still deleted on fail/cancel in `PTTButton`. No voice in structured logs (redact helpers). Tests cover cleanup name matching and unpredictable ids. Hardware mic/playback still unproven.

## 6. Mobile npm vulns

See `docs/MOBILE_DEPENDENCY_SECURITY.md`. `npm audit` reports 22 issues (14 high / 8 moderate), all Expo/Metro/`uuid` toolchain transitives. **Not production-send-path reachable.** No `--force`. No CRITICAL.

## 7. Push not offered

`POST /push/register` is **404**, omitted from OpenAPI. Copy: push is not offered. `/devices` and `/sync` remain 501. Tests: production does not expose a working push API.

## 8. Chaos / adversarial tests

Protocol `phase5Adversarial.test.ts` plus API `test_chaos.py` / identity tests cover concurrent sends, ACK before local SENT (now refused), ACK replay, truncated/unboxed inbound drop, wrong recipient, 5xx during send, queue after restart, network flap, TM BLE vs internet, PTT encrypt fail, malformed API, auth bypass, cross-user access. No false **DELIVERED** from HTTP. Inbound non-`crypto_box` payloads are dropped when crypto is configured.

## 9. Observability

Request correlation: `X-Request-ID` middleware (echo or generate). Access logs are method/path/status/duration + request id — no bodies. `redactForLog` / API `redact.py` strip secrets, ciphertext, and long base64. Transport failure categories (`categorizeTransportFailure`). `/health` and `/ready` unchanged. Tests for redact helpers and request-id headers.

## 10. Release gate

`scripts/production-readiness-gate.sh` plus CI job `production-gate` on this branch:

- protocol tests, API tests, mobile typecheck
- fail if `CHANGE_ME` is a Settings/code default
- fail if production CORS `*` guard is missing
- fail if mobile app path references `alg:none` / `encodeUnencryptedText`
- fail if `hopRuntime` registers `SimulatedNetwork` or relay
- identity + authenticated handshake helpers must exist

Hardware validation is **not** automated as passing.

## 11. Score (evidence-based)

Previous verified score **62 / 100**. Phase 5 **70 / 100**. Hardware-locked BLE/PTT/live-HTTPS points stay locked. Docs/design do not add points. FS = 0.

## 12. Remaining blockers

Unattested TOFU; lost-key new-account dead end; no two-phone BLE; no live non-localhost HTTPS; no EAS `projectId`; no FS; first GATT pk still TOFU; ephemeral plaintext playback file (short-lived); Expo toolchain audit noise.

## 13. Automated tests

Protocol **190 passed** / 0 failed (26 files). API **67 passed** / 0 failed. Mobile typecheck **passed**.

## 14. Physical tests still required

Unchanged device list from Phase 4 section I (`docs/BLE_TESTING.md`). Handshake unit tests are not radio proof.

## 15. Safe to begin physical-device validation?

**Yes, narrowly:** there is no known software crash/P0 in this branch that would make a development-client two-phone session a waste of time. Identity fail-closed, KEY_CHANGED, and authenticated handshake decode are in place.

**No, as proof:** software handshake tests ≠ GATT/MTU/background radio proof. Do not mark BLE or PTT production-implemented from this phase.

---

## A. VERIFIED SCORE /100

**70 / 100** (previous: **62 / 100**)

| Category | Phase 4 | Phase 5 | Delta |
|---|---|---|---|
| Core messaging reliability | 13 / 20 | 14 / 20 | +1 |
| Security & privacy | 12 / 20 | 14 / 20 | +2 |
| Backend/API production readiness | 10 / 15 | 11 / 15 | +1 |
| Mobile application stability | 8 / 15 | 8 / 15 | 0 |
| BLE / hybrid transport | 11 / 15 | 12 / 15 | +1 |
| PTT / voice | 2 / 5 | 3 / 5 | +1 |
| Testing & observability | 3 / 5 | 4 / 5 | +1 |
| Deployment readiness | 3 / 5 | 4 / 5 | +1 |
| **Total** | **62** | **70** | **+8** |

Not production-ready. Not > 90. No major product features. Software-only ceiling remains the high 70s / low 80s until phones + HTTPS + identity beyond TOFU + FS.

---

### CURRENT VERIFIED SCORE

**70 / 100**

### WHAT INCREASED THE SCORE

- **+2 security:** identity adversarial proofs (409/KEY_CHANGED/SQLite persist/fail-closed/malformed/cross-account) with tests. Still unattested TOFU; no FS.
- **+1 core messaging:** ACK before SENT cannot fabricate DELIVERED; unboxed inbound dropped; concurrent send uniqueness.
- **+1 BLE protocol (not hardware):** authenticated handshake with replay/stale/downgrade/KEY_CHANGED tests. **4 hardware-locked BLE points stay locked.**
- **+1 PTT software:** crypto-safe temp names + startup leftover cleanup tests. Mic/playback still unproven.
- **+1 backend:** request IDs, well-formed identity keys, registration IntegrityError.
- **+1 testing:** 162→190 protocol, 51→67 API, redact tests, gate job.
- **+1 deployment:** `production-readiness-gate.sh` + CI; push 404 honesty.
- **0** FS, live HTTPS, phones, mobile crash soak.

### WHAT PREVENTS 90+

No physical iPhone + Android BLE proof; no live non-localhost HTTPS soak; PTT not hardware-proven; unattested TOFU; no forward secrecy; no EAS `projectId` / proven VPS deploy.

### P0 BLOCKERS

1. Identity is client-published TOFU, not attested.
2. Lost identity secret is still a new-account dead end (`SERVER_KEY_LOCKED`).
3. No two-phone BLE proof.
4. Internet messaging unproven on live non-localhost HTTPS.
5. No production mobile pipeline (no EAS `projectId` / TestFlight).

### P1 BLOCKERS

- No forward secrecy (option B).
- First BLE GATT pk still plaintext TOFU (MAC is after both pks known).
- Voice ephemeral plaintext playback file (now shorter-lived / crash-cleaned).
- Expo/metro `image-size` / `uuid` audit findings are toolchain transitives.
- QR / safety-number UI not built.
- `alg: none` helpers remain test-only in the protocol package.

### AUTOMATED TEST RESULTS

| Suite | Command | Result |
|---|---|---|
| Protocol | `cd packages/protocol && npm test -- --run` | **190 passed**, 0 failed (26 files) |
| API | `cd apps/api && .venv/bin/pytest` | **67 passed**, 0 failed |
| Mobile | `cd apps/mobile && npm run typecheck` | **passed** |

No test fakes a physical BLE session. Internet protocol tests mock HTTP. API tests use `TestClient`.

### PHYSICAL TESTS STILL REQUIRED

Unchanged from Phase 4 (`HOP_PHASE4_REPORT.md` section I / `docs/BLE_TESTING.md`). Until recorded pass/fail, do not raise BLE to 15/15, do not give PTT full credit, and do not give internet messaging full credit.

---

*Phase 5 complete. Waiting for approval before any merge to `dev`.*
