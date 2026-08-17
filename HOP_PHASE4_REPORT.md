# HOP Phase 4 Production Stabilization Report

**Branch:** `integration/production-stabilization`  
**Date:** 2026-08-16  
**Crypto:** libsodium `crypto_box` (X25519 + XSalsa20-Poly1305) is unchanged. **Forward secrecy: option B (defer).** No ratchet. No Signal-level claims.  
**BLE hardware:** still **UNVERIFIED**. This phase did not run radios and does not claim BLE works on phones.

Phase 4 stops here pending approval. This branch is pushed to origin only. It is **not** merged to `dev` or `main`. Legacy branches were not touched. Phase 1–3 security is preserved (fail-closed identity, TOFU `KEY_CHANGED`, crypto `delivery_ack`, `sendGuards`, ephemeral voice, `__DEV__` diagnostics, TM-only send).

---

## A. VERIFIED SCORE /100

**62 / 100** (previous: **56 / 100**)

| Category | Phase 3 | Phase 4 | Delta |
|---|---|---|---|
| Core messaging reliability | 12 / 20 | 13 / 20 | +1 |
| Security & privacy | 11 / 20 | 12 / 20 | +1 |
| Backend/API production readiness | 8 / 15 | 10 / 15 | +2 |
| Mobile application stability | 8 / 15 | 8 / 15 | 0 |
| BLE / hybrid transport | 11 / 15 | 11 / 15 | 0 |
| PTT / voice | 2 / 5 | 2 / 5 | 0 |
| Testing & observability | 2 / 5 | 3 / 5 | +1 |
| Deployment readiness | 2 / 5 | 3 / 5 | +1 |
| **Total** | **56** | **62** | **+6** |

Not production-ready. Not > 90. No major product features added.

## B. Previous score

**56 / 100** (`HOP_STABILIZATION_MODE.md` Phase 3 baseline under this rubric).

## C. Exact reason for every point gained

| Points | Why (evidence, not “code exists”) |
|---|---|
| **+2 backend** | Isolation tests prove a stranger cannot list/read another conversation and cannot HTTP-ack a message unless they are the recipient. Duplicate `message_id` across users is 409. Oversized body is 422/413. Production refuses localhost/HTTP CORS, sqlite, localhost Redis. `create_all` is skipped when `APP_ENV=production`. Redis down in production returns **503** (no silent per-process widen). |
| **+1 security** | Automated 409 dead-end: different key → 409 `SERVER_KEY_LOCKED`; matching key idempotent; `publishIdentityIfAllowed` does **not** PUT on mismatch. Client states `IDENTITY_INACCESSIBLE` / `KEY_MISMATCH` / `SERVER_KEY_LOCKED`. Rotation **not** implemented (would need proof of old secret). |
| **+1 core messaging** | `phase4Reliability.test.ts` (13 cases) shows no false local DELIVERED from HTTP, queue survives restart, BLE-fail→internet retry, both-down encrypted queue, duplicate inbound/ACK, corrupt/wrong-key drop, 4xx/5xx/timeout stay QUEUED. |
| **+1 testing** | Protocol 131→**162**; API 40→**51**; still no E2E/device farm. |
| **+1 deployment** | Alembic-only production schema; nginx/API 256 KiB body cap; compose/docs updated. Compose was **not** executed here. |
| **0 BLE** | Protocol tests of malformed/oversized/duplicate/unauth ACK/KEY_CHANGED/replay nonce are real, but radios are still untested. Score stays 11. |
| **0 PTT** | Extra unit tests; hardware gate unchanged. |
| **0 mobile** | Typecheck only; no crash soak. |
| **0 FS** | Option B. `docs/FORWARD_SECRECY_DESIGN.md` updated. **No FS points.** |

## D. P0 blockers

1. Identity is **client-published TOFU**, not attested. First-contact spoofing remains possible.
2. Lost identity secret is still a **data-loss dead end** (`SERVER_KEY_LOCKED`). Recovery is a **new account**. Unauthenticated key replacement was correctly refused.
3. **No two-phone BLE proof.**
4. Internet messaging unproven on **live non-localhost HTTPS**.
5. No production mobile pipeline (no EAS `projectId` / TestFlight).

## E. P1 blockers

- No forward secrecy (static `crypto_box`).
- BLE handshake `user_id` / username / pk still plaintext GATT; session nonce is replay defense only.
- Voice ephemeral plaintext playback file (deleted after play).
- `/push/register` is 501. No privacy manifest / encryption-export keys.
- `alg: none` helpers remain in the protocol package (production send refuses).
- QR / safety-number **UI** not built (`markVerified` + fingerprint helpers only).
- Expo/metro `image-size` (high) and `uuid` (moderate) audit findings — toolchain transitives; `--force` would break Expo 57 / RN 0.86.

## F. Security findings

**Fixed / hardened this phase**

- Conversation membership enforced in tests (403 for outsiders).
- HTTP `/acks` 403 unless `recipient_id` matches the caller.
- Global `message_id` uniqueness with IntegrityError race handling.
- Production rate limiter does not fall back to memory.
- Request bodies not logged (path/method/status/duration only; uvicorn access log quieted).
- Identity publish path never PUTs a second key; 409 explained as `SERVER_KEY_LOCKED`.

**Still true (not regressions)**

- Server cannot attest keys (`docs/IDENTITY_TRUST.md`).
- First BLE GATT pk is TOFU. Handshake authentication with `crypto_auth`/`crypto_sign` was **not** added: first packet has no shared secret; adding Ed25519 identity keys was too large for this phase.
- No homemade Signal protocol. No unauthenticated identity rotation.

**Grep**

- No hardcoded production credentials. `CHANGE_ME` only in `.env.example` / compose comments (startup refuses them in production).
- No `console.log` of tokens, keys, or plaintext in `apps/mobile` or `apps/api`.
- `Math.random` remains only for ephemeral playback filenames (not crypto). Handshake nonce is a monotonic counter, not a key.
- `alg: none` / `encodeUnencryptedText` still test-only; production send refuses.
- `__DEV__` still gates Nearby debug ping, diagnostics, login LAN hints. Release SecureStore remains fail-closed.

## G. Production dependency findings

### `packages/protocol` `npm audit`

**0 vulnerabilities** (prod and including dev).

### `apps/mobile` `npm audit`

22 vulnerabilities (8 moderate, 14 high) reported. **Not force-fixed.**

| Advisory | Severity | Classification | Production send-path reachable? | Action |
|---|---|---|---|---|
| `image-size` via metro / `@expo/metro` / `expo` / `react-native` | high (DoS in ICNS/JXL/HEIF parsers) | Transitive of Expo/RN **bundler**. `npm audit --omit=dev` still lists it because `expo`/`react-native` are app dependencies. | **No** — not in `crypto_box` / MessageService. Affects Metro image parsing at build/dev time. | Leave. `npm audit fix --force` would install `expo@53` or `react-native@0.72` (breaking). |
| `uuid` via `xcode` / `@expo/config-plugins` | moderate (buffer bounds in v3/v5/v6 when `buf` provided) | Transitive **prebuild** toolchain | **No** — iOS prebuild, not app send path | Leave. Force fix would install `expo@53`. |

No production-reachable high/critical in the message/crypto path was safely patchable without a breaking Expo upgrade.

### Python

`pip-audit` is **not installed** in `apps/api/.venv`. Not run. Pinned FastAPI 0.115 / uvicorn 0.34 / sqlmodel / argon2 / redis / alembic as before.

## H. Exact automated test counts

| Suite | Command | Result |
|---|---|---|
| Protocol | `cd packages/protocol && npm test -- --run` | **162 passed**, 0 failed (**23** files) |
| API | `cd apps/api && .venv/bin/pytest` | **51 passed**, 0 failed |
| Mobile | `cd apps/mobile && npm run typecheck` | **passed** |

Phase 3 was 131 protocol + 40 API. New coverage includes `test_authz.py`, production Redis/CORS/`create_all` tests, `bleProtocol.test.ts`, `phase4Reliability.test.ts`, identity 409 client tests, PTT encrypt-fail/corrupt/mic helpers.

Torture tests **cannot** prove: radio MTU/GATT, physical ACK timing, real TLS, `expo-sqlite` across kill, mic/speaker.

## I. Impossible without physical phones

Unchanged device list (still unexecuted):

1. iPhone + Android development builds; `munim-bluetooth` loads; permission prompts.
2. Mutual Nearby discovery by username.
3. GATT handshake v2 (`sessionEstablished`; connect fails without `pk`).
4. Encrypted BLE text in the **same** conversation as internet chat; duplicate `message_id` does not duplicate inbox; ACK within 8s or honest failure.
5. Same with Wi-Fi/cellular off.
6. Internet on: `InternetTransport`; API down + peer mapped → BLE.
7. Background: leave Nearby → scan/advertise stop.
8. Identity publish 200; second different key 409; kill app → SecureStore still decrypts (no silent regen).
9. PTT: hold-to-record ≤8s; peer plays audio; payload is crypto_box; queue across kill.
10. Offline queue on `expo-sqlite`: airplane send → reconnect → same `message_id` once.

## J. Impossible without real HTTPS deployment

- Two-user internet chat on a **live non-localhost HTTPS** API: ciphertext in DB/WS; UI plaintext only after local decrypt; crypto `delivery_ack` → Delivered.
- Production CORS allow-list + Redis-backed rate limits under multi-worker load.
- `/ready` against real Postgres+Redis.
- Release client `EXPO_PUBLIC_API_URL=https://…` (localhost refused).
- Nginx TLS, 256 KiB body cap, WebSocket upgrade — compose exists, **not run here**.

## K. Shortest evidence-based path to >90

Hardware + hosted API dominate the remaining ~28 points. Docs will not get there.

1. **Physical iPhone + Android** development clients; record `docs/BLE_TESTING.md` pass/fail (unlocks BLE out of the low teens; still not 15/15 until soak).
2. **Hosted HTTPS** API (compose on a VPS, explicit `CORS_ORIGINS`, non-default DB/Redis). Two-phone internet soak + queue across kill (unlocks core messaging and backend).
3. **PTT on those phones** (mic, play, queue) — remaining PTT points.
4. **EAS `projectId` + preview build** (`developmentClient: false`) pointed at that API (deployment + mobile).
5. Identity beyond TOFU and FS (option A / libsignal) remain **post-90** crypto milestones unless a reviewed library is adopted; they cap security well below 20/20 until then.

Even a perfect two-phone + HTTPS run cannot honestly reach 90 while identity is unattested TOFU and there is no FS — expect a ceiling in the **high 70s / low 80s** until those change. Do not inflate.

## L. Recommended Phase 5

**Physical-device validation + one real HTTPS preview**, not more protocol invention:

1. Run `docs/BLE_TESTING.md` on one iPhone + one Android **development** client. Record pass/fail. Do not mark BLE production-implemented unless both pass.
2. Deploy compose to a VPS (manual; this repo does not auto-deploy). Point a preview EAS build at `https://`.
3. Soak 1:1 internet chat (queue across kill, crypto receipts, KEY_CHANGED copy, 409 new-account recovery).
4. Keep FS, mesh, groups, push, Event Mode postponed.
5. Only after (1)–(3) are recorded, consider merging this branch to `dev`.

---

## Phase 4 work completed (for reviewers)

- FastAPI: authz tests, size limits, Redis fail-closed in production, `create_all` disabled in production, tighter CORS, access logs without bodies, conversation single transaction.
- Identity: `SERVER_KEY_LOCKED`, `publishIdentityIfAllowed`, `docs/IDENTITY_TRUST.md`, fingerprint helpers, Settings 409 copy. **No rotation API** (would require proof of old secret).
- FS: option B; migration steps in `docs/FORWARD_SECRECY_DESIGN.md`.
- BLE protocol: chunk/envelope limits, handshake nonce + replay guard, idle session timeout, KEY_CHANGED send refuse. First-packet pk remains TOFU.
- PTT: encrypt-fail, corrupt inbound, mic-denied helper, cleanup name helper.
- Reliability torture file as specified.

---

### CURRENT VERIFIED SCORE

**62 / 100**

### WHAT INCREASED THE SCORE

+2 backend (isolation, Alembic-only prod, Redis fail-closed, size limits). +1 security (409 client/server states tested). +1 core messaging (torture tests, no false DELIVERED). +1 testing. +1 deployment config. **0** for BLE radios, PTT hardware, FS, or live HTTPS.

### WHAT PREVENTS 90+

No phones, no hosted HTTPS, unattested TOFU, no FS, no EAS `projectId`.

### P0 BLOCKERS

TOFU identity; lost-key new-account dead end; unverified BLE; no live HTTPS; no store pipeline.

### P1 BLOCKERS

No FS; plaintext BLE handshake; ephemeral voice playback file; push 501; Expo toolchain audit noise; no QR UI.

### AUTOMATED TEST RESULTS

Protocol **162** passed / 0 failed (23 files). API **51** passed / 0 failed. Mobile typecheck **passed**.

### PHYSICAL TESTS STILL REQUIRED

See section I. None executed this phase.

---

*Phase 4 complete. Waiting for approval before any merge to `dev`.*
