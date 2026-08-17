# HOP Production Stabilization Mode

**Branch:** `integration/production-stabilization` only. **Do not merge to `dev` or `main`.**  
**Cursor rule:** `.cursor/rules/hop-production-stabilization.mdc` (always apply).  
**This scorecard:** Phase 4 (2026-08-16) under the evidence-based rubric. Canonical narrative: `HOP_PHASE4_REPORT.md`.

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

Sources for this score (not substitutes for hardware or live HTTPS): `HOP_PRODUCTION_AUDIT.md`, `HOP_PHASE2_SECURITY_REPORT.md`, `HOP_PHASE3_REPORT.md`, `HOP_PHASE4_REPORT.md`.

Prior scores used a different, unstructured scale (audit **38**, Phase 2 **~46**, Phase 3 **54**). This document **recalculates** on the rubric above. It does not carry those numbers forward.

---

## Current scorecard (Phase 4)

Phase 3 baseline under this rubric was **56 / 100**. Phase 4 is **62 / 100**. Hardware-dependent points remain unavailable. Docs and “code exists” do not add points. Forward secrecy is option B (deferred) and scores **0**.

### Core messaging reliability — **13 / 20** (+1)

**Evidence**

- Unchanged 1:1 path: Chat → `MessageService` → `TransportManager` → opaque `crypto_box`.
- Phase 4 torture tests (`phase4Reliability.test.ts`): internet send, internet lost, BLE-selected-then-fail → internet retry, both down → encrypted queue, restart+flush, retry/FAILED, crypto ACK once, duplicate inbound, out-of-order, corrupt ciphertext, wrong peer key, KEY_CHANGED refuse, HTTP 4xx/5xx/timeout, concurrent sends, PTT queued offline. No false **DELIVERED** from HTTP.

**Why not full credit**

- Still mocked HTTP / sql.js. No live non-localhost HTTPS. No `expo-sqlite` process-kill proof.

### Security & privacy — **12 / 20** (+1)

**Evidence**

- Phase 2 invariants preserved. `publishIdentityIfAllowed` never PUTs on mismatch; HTTP 409 → `SERVER_KEY_LOCKED`. Matching PUT is idempotent. Fingerprint display helpers exist (`formatPersistedFingerprint`); `markVerified` unchanged.
- API: member isolation, recipient-only HTTP acks, `message_id` uniqueness, oversized 413/422, production CORS must be HTTPS non-localhost, Redis required for rate limits (no silent widen).

**Why not full credit**

- Still unattested TOFU. No FS (`docs/FORWARD_SECRECY_DESIGN.md` option B). Lost secret → new account (documented, not weakened). BLE first-packet pk still plaintext GATT.

### Backend/API production readiness — **10 / 15** (+2)

**Evidence**

- `init_db()` skips `create_all` in production (Alembic-only). Request size cap 256 KiB. Conversation create is one transaction. **51** pytest passed including isolation/duplicate/oversize/production validation.

**Why not full credit**

- No live Postgres+Redis+HTTPS in this environment. Push still 501.

### Mobile application stability — **8 / 15** (0)

Unchanged evidence. Typecheck passed. No device crash/soak.

### BLE / hybrid transport — **11 / 15** (0)

Protocol hardening (chunk/envelope limits, handshake nonce replay, idle session timeout, `bleSendRefusal` on KEY_CHANGED) is tested in-process. **Still no two-phone radio proof.** Score does not rise.

### PTT / voice — **2 / 5** (0)

More unit coverage (encrypt failure, corrupt inbound, mic-denied helper, ephemeral filename cleanup). **Mic/playback/transport/queue not tested on phones.**

### Testing & observability — **3 / 5** (+1)

Protocol **162** / API **51** / mobile typecheck. Still no E2E, device farm, or live Prometheus.

### Deployment readiness — **3 / 5** (+1)

`create_all` disabled in prod; nginx `client_max_body_size 256k`; Redis fail-closed documented. Compose still **not executed** here. No EAS `projectId`.

---

## Phase 4 end-of-phase block

### CURRENT VERIFIED SCORE

**62 / 100**

| Category | Score |
|---|---|
| Core messaging reliability | 13 / 20 |
| Security & privacy | 12 / 20 |
| Backend/API production readiness | 10 / 15 |
| Mobile application stability | 8 / 15 |
| BLE / hybrid transport | 11 / 15 |
| PTT / voice | 2 / 5 |
| Testing & observability | 3 / 5 |
| Deployment readiness | 3 / 5 |
| **Total** | **62 / 100** |

This is **not** production-ready. It is **not** > 90. No major product features.

### WHAT INCREASED THE SCORE

- **+2 backend:** isolation tests, `create_all` off in production, Redis fail-closed, request size limits, HTTPS/non-localhost CORS validation.
- **+1 security:** 409/KEY_MISMATCH/SERVER_KEY_LOCKED tested; client does not PUT on mismatch.
- **+1 core messaging:** torture tests (fallback, queue survive, no false DELIVERED).
- **+1 testing:** 162 protocol + 51 API (from 131 + 40).
- **+1 deployment:** Alembic-only prod schema + body limits in compose/nginx.
- **0** BLE/PTT/mobile/FS (no phones, no ratchet, no crash soak).

### WHAT PREVENTS 90+

- No physical iPhone + Android BLE proof (BLE cannot go to 15/15).
- No two-device internet soak against a **live non-localhost HTTPS** API.
- PTT not hardware-proven.
- Identity still unattested TOFU; no forward secrecy; lost key → new account.
- No TestFlight/EAS `projectId` / proven VPS deploy.

### P0 BLOCKERS

1. Identity is client-published TOFU, not attested.
2. Lost identity secret is still a data-loss dead end (409 `SERVER_KEY_LOCKED`; recovery is a new account).
3. No two-phone BLE proof.
4. Internet messaging unproven on live non-localhost HTTPS.
5. No production mobile pipeline (no EAS `projectId` / TestFlight).

### P1 BLOCKERS

- No forward secrecy (option B).
- BLE handshake still plaintext GATT (nonce is replay defense, not first-packet auth).
- Voice ephemeral plaintext playback file.
- `/push/register` is 501. No privacy manifest.
- `alg: none` helpers still in the protocol package (production send refuses).
- Expo/metro `image-size` / `uuid` audit findings are toolchain transitives; `--force` would break Expo 57.

### AUTOMATED TEST RESULTS

| Suite | Command | Result |
|---|---|---|
| Protocol | `cd packages/protocol && npm test -- --run` | **162 passed**, 0 failed (23 files) |
| API | `cd apps/api && .venv/bin/pytest` | **51 passed**, 0 failed |
| Mobile | `cd apps/mobile && npm run typecheck` | **passed** |

No test fakes a physical BLE session. Internet protocol tests mock HTTP. API tests use `TestClient`.

### PHYSICAL TESTS STILL REQUIRED

Unchanged from Phase 3 (see `HOP_PHASE4_REPORT.md` section I). Until recorded pass/fail, do not raise BLE above the low teens, do not give PTT full credit, and do not give internet messaging full credit.

---

*Phase 4 complete. Waiting for approval before any merge to `dev`.*
