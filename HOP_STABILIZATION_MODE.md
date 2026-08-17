# HOP Production Stabilization Mode

**Branch:** `integration/production-stabilization` only. **Do not merge to `dev` or `main`.**  
**Cursor rule:** `.cursor/rules/hop-production-stabilization.mdc` (always apply).  
**This scorecard:** Phase 3 baseline under the evidence-based rubric (rescored 2026-08-16). Application code was not changed for this document.

---

## Policy

- **No new major product features** until the verified production-readiness score is **> 90/100**.
- **Postpone:** Event Mode, mesh/multi-hop relay, group PTT, live voice calls, new social features, monetization, major animations/polish that do not improve reliability.
- **Existing features MAY** be fixed, hardened, completed, tested, or integrated.
- Scoring is **evidence-based**. Do not increase the score simply because code exists.
- A category **cannot receive full credit** when critical behavior is only mocked/simulated.
- **BLE** cannot receive full credit until tested on **physical phones**.
- **PTT** cannot receive full credit until **mic, playback, transport, and queue** are tested on physical phones.
- **Internet messaging** cannot receive full credit until tested against a **live non-localhost HTTPS** backend.
- **Even at 90+**, no new feature work if there is still a **P0 security or data-loss** issue.

Every stabilization phase must end with:

- CURRENT VERIFIED SCORE
- WHAT INCREASED THE SCORE
- WHAT PREVENTS 90+
- P0 BLOCKERS
- P1 BLOCKERS
- AUTOMATED TEST RESULTS
- PHYSICAL TESTS STILL REQUIRED

---

## Rubric (max 100)

| Category | Max |
|---|---|
| Core messaging reliability | 20 |
| Security & privacy | 20 |
| Backend/API production readiness | 15 |
| Mobile application stability | 15 |
| BLE / hybrid transport | 15 |
| PTT / voice | 5 |
| Testing & observability | 5 |
| Deployment readiness | 5 |
| **Total** | **100** |

Sources for this score (not substitutes for hardware or live HTTPS): `HOP_PRODUCTION_AUDIT.md`, `HOP_PHASE2_SECURITY_REPORT.md`, `HOP_PHASE3_REPORT.md`, and `origin/integration/production-stabilization` at `4384f81`.

Prior scores used a different, unstructured scale (audit **38**, Phase 2 **~46**, Phase 3 **54**). This document **recalculates** on the rubric above. It does not carry those numbers forward.

---

## Current scorecard (Phase 3 baseline under new rubric)

### Core messaging reliability — **12 / 20**

**Evidence**

- 1:1 send path is real: Chat → `MessageService` → `TransportManager` → `InternetTransport` → opaque `crypto_box` on `POST /conversations/{id}/messages` → WebSocket fan-out → `acceptInbound` decrypt (`packages/protocol`, `apps/api`, `apps/mobile`).
- SQLite outbound queue, per-conversation order, bounded retry → **FAILED**, durable `processed_ids`, and cryptographic `delivery_ack` (HTTP `DELIVERED` is ignored) are implemented and covered by protocol tests (`offlineSync.test.ts`, `phase2Security.test.ts`, `phase3Reliability.test.ts`).
- Nearby production CTA opens the same conversation as internet chat (smart-transport-ui merge). Relay is not registered on the mobile TransportManager.

**Why not full credit**

- Internet messaging has **not** been tested against a live non-localhost HTTPS backend (policy gate). Protocol tests mock HTTP; API tests use FastAPI `TestClient`.
- Offline queue is proven with **sql.js**, not `expo-sqlite` across a phone process kill.
- Hybrid reliability still depends on BLE, which is unverified on radios.

### Security & privacy — **11 / 20**

**Evidence**

- libsodium `crypto_box` (X25519 + XSalsa20-Poly1305) round-trips in `cryptoBox.test.ts`. API rejects plaintext / `alg: none` on send (`test_security.py`).
- Phase 2: production SecureStore **fail-closed**, identity marker (no silent regen), `KEY_MISMATCH` vs server pk, `PUT` body `{ public_key }` only (`extra=forbid`).
- Persistent TOFU with `KEY_CHANGED` (no auto-trust). Delivery **DELIVERED** only after a decrypted recipient `delivery_ack`. BLE GATT ACK is a `crypto_auth` MAC, not UTF-8 `message_id`.
- Production API startup refuses `CORS_ORIGINS=*`, missing `DATABASE_URL`/`REDIS_URL`, and `CHANGE_ME` / localhost Postgres default.

**Why not full credit**

- Identity is still **client-published TOFU**, not attested. First-contact spoofing remains possible. Not Signal. No forward secrecy (`docs/FORWARD_SECRECY_DESIGN.md` only).
- Lost identity secret is still a server **409** dead end (explicit local replace cannot publish a second pk).
- BLE handshake `user_id` / username / pk remain plaintext GATT. Server stores rich metadata beside ciphertext. `encodeUnencryptedText` / `alg: none` still exist in the protocol package (production send refuses them).
- Voice playback still writes an **ephemeral plaintext** temp file for expo-av.

### Backend/API production readiness — **8 / 15**

**Evidence**

- Real FastAPI: register/login, 1:1 conversations, opaque ciphertext, first-frame WS auth, argon2id, identity immutability, in-process + optional Redis rate limits. **40** pytest passed.
- Alembic `001_initial` exists. Production config tests cover fail-closed CORS/secrets (`test_config.py`).
- `/push/register`, `/devices`, `/sync` honestly return **501**.

**Why not full credit**

- No evidence of a live Postgres+Redis+HTTPS deploy in this environment (`docs/PLATFORM_LIMITATIONS.md`: Docker not installed here).
- `init_db()` still `create_all` in API lifespan (Alembic drift risk).
- `/ready` requires Redis. Rate limits fall back to per-process memory if Redis is down. Push is unimplemented.

### Mobile application stability — **8 / 15**

**Evidence**

- Real Expo app: login, chats, chat thread, Nearby, settings, contacts. `OfflineProvider` + `HopSqliteStore`. Honest banners (Offline / Nearby / Online / Queued / Reconnecting) and bubble states (Queued / Sending / Sent / Delivered / Failed / Retrying).
- Release URL policy: `EXPO_PUBLIC_API_URL` required; localhost and cleartext HTTP refused unless staging flag (`apiUrlPolicy.ts`, `app.json` `requiresHttpsApiInRelease`).
- Mobile **typecheck passed**. `sendTestPayload` remains `__DEV__`-gated.

**Why not full credit**

- No crash/soak evidence on physical phones. No mobile unit test runner (logic is tested in `@hop/protocol` with fakes).
- `app.json` still includes the **expo-dev-client** plugin. No EAS `projectId`. Version `0.1.0`. No privacy manifest / encryption-export keys.

### BLE / hybrid transport — **11 / 15**

**Evidence**

- `HopBleEngine` + `munim-bluetooth`: scan, advertise, connect, chunked writes, handshake v2, authenticated ACK. Payloads must be `crypto_box`. Expo Go/web blocked.
- TransportManager live priority is `internet`, `bluetooth`. Bluetooth throws fall through to internet or honest `{ ok:false }`. Conversation IDs unified with internet chat on this branch.
- Protocol tests exist (`bluetoothTransport.test.ts`, `bleAck.test.ts`, `bleCodec.test.ts`).

**Why not full credit**

- **Zero evidence of a successful two-phone BLE session.** `docs/BLE_TESTING.md` / `docs/PLATFORM_LIMITATIONS.md`: no Xcode / no attached phones here. Tests use **`MockBleLink`** / in-process fakes — mocked BLE ≠ BLE works.
- Mesh / multi-hop relay remains a **simulator** (`SimulatedNetwork`) plus unimplemented `createRelayTransport`. Do not claim real-world mesh.

### PTT / voice — **2 / 5**

**Evidence**

- HOLD TO HOP uses `MessageService.sendVoice` → same `crypto_box` + TransportManager as text. Recording file deleted after encode. Playback temps deleted on end/unmount (`apps/mobile/src/voice/cache.ts`). Mic-denial copy exists. UI no longer pretends random bars are a mic meter.
- Protocol tests: boxed voice, no durable plaintext audio in SQLite, mocked BLE route, queue + FAILED (`voice.test.ts`, `productionStabilization.test.ts`).

**Why not full credit**

- **Mic, playback, transport, and queue have not been tested on physical phones** (policy gate).
- 8-second clip, not a live call (live calls are postponed). Recordings are plaintext until boxed; playback is an ephemeral plaintext file. Voice BLE tests register a fake transport.

### Testing & observability — **2 / 5**

**Evidence**

- CI: protocol `npm test`, API `pytest`, mobile `tsc` (`.github/workflows/ci.yml`).
- This rescore: protocol **131 passed** / 0 failed (20 files); API **40 passed** / 0 failed; mobile typecheck **passed**.
- API Prometheus metrics module + optional compose profile exist.

**Why not full credit**

- No E2E, no device farm, no mobile unit runner. BLE / PTT / internet protocol tests are mocked or `TestClient`. Prometheus is not proven in a live deploy. No mobile crash telemetry.

### Deployment readiness — **2 / 5**

**Evidence**

- `eas.json` has `preview` and `production` profiles with `developmentClient: false`. `DEPLOYMENT.md` + `infra/docker-compose.prod.yml`. Release client refuses localhost API URLs.

**Why not full credit**

- No EAS `projectId`, no recorded TestFlight/App Store build, no proven hosted HTTPS API. Docker Compose has **not** been executed in this environment. `create_all` still runs beside Alembic.

---

## Phase 3 baseline under new rubric

### CURRENT VERIFIED SCORE

**56 / 100**

| Category | Score |
|---|---|
| Core messaging reliability | 12 / 20 |
| Security & privacy | 11 / 20 |
| Backend/API production readiness | 8 / 15 |
| Mobile application stability | 8 / 15 |
| BLE / hybrid transport | 11 / 15 |
| PTT / voice | 2 / 5 |
| Testing & observability | 2 / 5 |
| Deployment readiness | 2 / 5 |
| **Total** | **56 / 100** |

This is **not** production-ready. It is **not** > 90. No major product features.

### WHAT INCREASED THE SCORE

**Nothing in this phase.** This commit only persists the stabilization policy and rescores existing Phase 1–3 evidence on the new rubric. It does not add product, hardware, or live-HTTPS proof.

Mapping note (not a bonus): Phase 3 claimed **54** on an unstructured 100-point scale. Recalculating the **same** branch on this rubric yields **56** because BLE has a dedicated 15-point bucket (capped at **11** for implemented + mocked tests + no phones). That is a weight change, not new evidence. Do not treat 56 as a product improvement over 54.

### WHAT PREVENTS 90+

- No physical iPhone + Android BLE proof (BLE cannot go to 15/15).
- No two-device internet soak against a **live non-localhost HTTPS** API (core messaging cannot go to 20/20).
- PTT not hardware-proven (mic / playback / transport / queue).
- Identity still unattested TOFU; no forward secrecy; 409 on key loss (security well short of 20/20).
- No TestFlight/production EAS build, no EAS `projectId`, no proven VPS/Postgres deploy.
- No push; `create_all` drift; no device E2E / crash telemetry.

### P0 BLOCKERS

1. **Identity is client-published TOFU, not attested.** First-contact spoofing remains possible. Do not claim production E2EE / Signal-grade.
2. **Lost identity secret is a data-loss dead end** (server 409; explicit local replace cannot publish a new pk).
3. **No two-phone BLE proof.** Nearby is implemented in source and unverified on hardware.
4. **Internet messaging unproven on live non-localhost HTTPS.** Unit/`TestClient`/mocked HTTP do not count.
5. **No production mobile pipeline in evidence:** no EAS `projectId`, no TestFlight/App Store build against a hosted API.

### P1 BLOCKERS

- No forward secrecy (static `crypto_box`; compromise of the long-term secret decrypts history).
- BLE handshake `user_id` / username / pk still plaintext GATT; envelope metadata visible beside ciphertext.
- Voice ephemeral plaintext playback file (deleted after play); recordings plaintext until boxed.
- `/push/register` is 501. No privacy manifest / honest encryption-export declaration.
- `init_db()` `create_all` still in API lifespan. Rate limits are per-process if Redis is down.
- `alg: none` helpers still in the protocol package. QR / safety-number UX not built (`markVerified` only).
- Mesh/relay UI history vs unimplemented physical relay — keep copy honest; do not build mesh.

### AUTOMATED TEST RESULTS

Recorded on `integration/production-stabilization` (same tree as Phase 3, plus this policy/docs commit):

| Suite | Command | Result |
|---|---|---|
| Protocol | `cd packages/protocol && npm test -- --run` | **131 passed**, 0 failed (20 files) |
| API | `cd apps/api && .venv/bin/pytest` | **40 passed**, 0 failed |
| Mobile | `cd apps/mobile && npm run typecheck` | **passed** |

No test fakes a physical BLE session. BLE cases use `MockBleLink` / in-process transports. Internet protocol tests mock HTTP. API chat tests use `TestClient`, not a hosted HTTPS server.

### PHYSICAL TESTS STILL REQUIRED

None of these are satisfied by CI, simulators, Expo Go, or mocks (`HOP_PRODUCTION_AUDIT.md` device list; still unexecuted):

1. iPhone + Android **development builds** (not Expo Go); `munim-bluetooth` loads; permission prompts appear.
2. Mutual Nearby discovery by **username**.
3. GATT handshake v2 (`sessionEstablished`; connect fails without `pk`).
4. Encrypted BLE **text** in the **same** conversation as internet chat; duplicate `message_id` does not duplicate inbox; ACK within 8s or honest failure.
5. Same as (4) with Wi-Fi/cellular **off**.
6. Internet **on**: send uses `InternetTransport`; API down + peer mapped → BLE.
7. Background: leave Nearby / background app → scan/advertise stop.
8. Identity publish: `PUT /users/me/identity` 200; second different key 409; kill app → SecureStore still decrypts history (no silent regen).
9. Two-user internet chat on a **live HTTPS** API (not localhost): ciphertext in DB/WS; UI plaintext only after local decrypt; crypto `delivery_ack` → Delivered.
10. PTT on phones: hold-to-record ≤8s; peer plays audio; payload is crypto_box; queue across kill.
11. Offline queue on `expo-sqlite`: airplane send → reconnect → same `message_id` once.

Until those are recorded pass/fail, **do not** raise BLE above the low teens, **do not** give PTT full credit, and **do not** give internet messaging full credit.

---

*Stabilization mode adopted. Waiting for approval before any merge to `dev`.*
