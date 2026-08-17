# HOP Production Stabilization Mode

**Branch:** `integration/production-stabilization` only. **Do not merge to `dev` or `main`.**  
**Cursor rule:** `.cursor/rules/hop-production-stabilization.mdc` (always apply).  
**This scorecard:** Phase 5 (2026-08-16) under the evidence-based rubric. Canonical narrative: `HOP_PHASE5_REPORT.md`.

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

Sources for this score (not substitutes for hardware or live HTTPS): `HOP_PRODUCTION_AUDIT.md`, `HOP_PHASE2_SECURITY_REPORT.md`, `HOP_PHASE3_REPORT.md`, `HOP_PHASE4_REPORT.md`, `HOP_PHASE5_REPORT.md`.

Prior scores used a different, unstructured scale (audit **38**, Phase 2 **~46**, Phase 3 **54**). This document **recalculates** on the rubric above. It does not carry those numbers forward.

---

## Current scorecard (Phase 5)

Phase 4 was **62 / 100**. Phase 5 is **70 / 100**. Hardware-dependent points remain unavailable. Docs and “code exists” do not add points. Forward secrecy is option B (deferred) and scores **0**.

### Core messaging reliability — **14 / 20** (+1)

**Evidence**

- Unchanged 1:1 path: Chat → `MessageService` → `TransportManager` → opaque `crypto_box`.
- ACK before local SENT cannot become DELIVERED. Unboxed inbound is dropped. Concurrent send ids stay unique. No false **DELIVERED** from HTTP.

**Why not full credit**

- Still mocked HTTP / sql.js. No live non-localhost HTTPS. No `expo-sqlite` process-kill proof.

### Security & privacy — **14 / 20** (+2)

**Evidence**

- Identity adversarial tests: 409 `SERVER_KEY_LOCKED`, KEY_CHANGED, SQLite fingerprint persist, fail-closed loss, malformed keys, cross-account pk refuse. No unauthenticated rotation.
- BLE handshake MAC after both pks known (`crypto_auth` + `crypto_box_beforenm`). First GATT pk remains TOFU.

**Why not full credit**

- Still unattested TOFU. No FS. Lost secret → new account. First-packet pk still plaintext GATT.

### Backend/API production readiness — **11 / 15** (+1)

**Evidence**

- Request correlation ids, well-formed identity keys, registration IntegrityError, push **404** (not offered). **67** pytest passed.

**Why not full credit**

- No live Postgres+Redis+HTTPS in this environment.

### Mobile application stability — **8 / 15** (0)

Unchanged evidence. Typecheck passed. No device crash/soak.

### BLE / hybrid transport — **12 / 15** (+1)

Authenticated handshake is tested in-process (replay/stale/downgrade/KEY_CHANGED). **Still no two-phone radio proof.** The 4 hardware-locked points stay locked.

### PTT / voice — **3 / 5** (+1)

Crypto-safe temp names, leftover `hop-voice*` cleanup on startup, encrypted persist only. **Mic/playback/transport/queue not tested on phones.**

### Testing & observability — **4 / 5** (+1)

Protocol **190** / API **67** / mobile typecheck / redact + request-id tests / production-readiness gate. Still no E2E, device farm, or live Prometheus.

### Deployment readiness — **4 / 5** (+1)

`scripts/production-readiness-gate.sh` + CI job. Push not advertised. Compose still **not executed** here. No EAS `projectId`.

---

## Phase 5 end-of-phase block

### CURRENT VERIFIED SCORE

**70 / 100**

| Category | Score |
|---|---|
| Core messaging reliability | 14 / 20 |
| Security & privacy | 14 / 20 |
| Backend/API production readiness | 11 / 15 |
| Mobile application stability | 8 / 15 |
| BLE / hybrid transport | 12 / 15 |
| PTT / voice | 3 / 5 |
| Testing & observability | 4 / 5 |
| Deployment readiness | 4 / 5 |
| **Total** | **70 / 100** |

This is **not** production-ready. It is **not** > 90. No major product features.

### WHAT INCREASED THE SCORE

- **+2 security:** identity adversarial tests (409, KEY_CHANGED persist, fail-closed, malformed, cross-account).
- **+1 core messaging:** no ACK-before-SENT DELIVERED; unboxed inbound dropped.
- **+1 BLE protocol:** authenticated handshake tests (not hardware).
- **+1 PTT software:** crypto-safe temps + crash leftover cleanup.
- **+1 backend:** request ids + identity key validation.
- **+1 testing:** 190 protocol + 67 API + gate.
- **+1 deployment:** gate script/CI + push 404.
- **0** phones, live HTTPS, FS, mobile soak.

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
- First BLE GATT pk still TOFU (MAC after both pks known).
- Voice ephemeral plaintext playback file (short-lived).
- Expo/metro `image-size` / `uuid` audit findings are toolchain transitives; `--force` would break Expo 57.
- QR / safety-number UI not built.

### AUTOMATED TEST RESULTS

| Suite | Command | Result |
|---|---|---|
| Protocol | `cd packages/protocol && npm test -- --run` | **190 passed**, 0 failed (26 files) |
| API | `cd apps/api && .venv/bin/pytest` | **67 passed**, 0 failed |
| Mobile | `cd apps/mobile && npm run typecheck` | **passed** |

No test fakes a physical BLE session. Internet protocol tests mock HTTP. API tests use `TestClient`.

### PHYSICAL TESTS STILL REQUIRED

Unchanged from Phase 4 (see `HOP_PHASE5_REPORT.md` section 14). Until recorded pass/fail, do not raise BLE to 15/15, do not give PTT full credit, and do not give internet messaging full credit.

---

*Phase 5 complete. Waiting for approval before any merge to `dev`.*
