# HOP Production Stabilization Mode

**Branch:** `integration/production-stabilization` only. **Do not merge to `dev` or `main`.**  
**Cursor rule:** `.cursor/rules/hop-production-stabilization.mdc` (always apply).  
**This scorecard:** Phase 7 (2026-08-16) under the evidence-based rubric. Canonical narrative: `HOP_PHASE7_REPORT.md`. Previous: `HOP_PHASE6_REPORT.md` (72). Live HTTPS was **not** verified this phase.

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

Sources for this score (not substitutes for hardware or live HTTPS): `HOP_PRODUCTION_AUDIT.md`, `HOP_PHASE2_SECURITY_REPORT.md`, `HOP_PHASE3_REPORT.md`, `HOP_PHASE4_REPORT.md`, `HOP_PHASE5_REPORT.md`, `HOP_PHASE6_REPORT.md`, `HOP_PHASE7_REPORT.md`.

Prior scores used a different, unstructured scale (audit **38**, Phase 2 **~46**, Phase 3 **54**). This document **recalculates** on the rubric above. It does not carry those numbers forward.

---

## Current scorecard (Phase 7)

Phase 6 was **72 / 100**. Phase 7 is **72 / 100**. Fly.io config and docs do not add points. Hardware-dependent points remain unavailable. Docs and “code exists” do not add points. Forward secrecy is option B (deferred) and scores **0**. Live HTTPS was **not** proven: no Fly/Render account or public URL in this environment.

### Core messaging reliability — **14 / 20** (0)

**Evidence**

- Unchanged 1:1 path: Chat → `MessageService` → `TransportManager` → opaque `crypto_box`.
- ACK before local SENT cannot become DELIVERED. Unboxed inbound is dropped. Concurrent send ids stay unique. No false **DELIVERED** from HTTP.

**Why not full credit**

- Still mocked HTTP / sql.js. No live non-localhost HTTPS. No `expo-sqlite` process-kill proof.

### Security & privacy — **14 / 20** (0)

**Evidence**

- Identity adversarial tests: 409 `SERVER_KEY_LOCKED`, KEY_CHANGED, SQLite fingerprint persist, fail-closed loss, malformed keys, cross-account pk refuse. No unauthenticated rotation.
- BLE handshake MAC after both pks known (`crypto_auth` + `crypto_box_beforenm`). First GATT pk remains TOFU.
- Production unhandled errors sanitized; logs still redact secrets / ciphertext / voice.

**Why not full credit**

- Still unattested TOFU. No FS. Lost secret → new account. First-packet pk still plaintext GATT.

### Backend/API production readiness — **11 / 15** (0)

**Evidence**

- Request correlation ids, well-formed identity keys, registration IntegrityError, push **404** (not offered). **74** pytest passed.
- `API_PUBLIC_URL` HTTPS/localhost reject is scored under **deployment**, not here: there is still no live Postgres+Redis+HTTPS (Fly files are prep only).

**Why not full credit**

- No live Postgres+Redis+HTTPS in this environment.

### Mobile application stability — **9 / 15** (0)

**Evidence**

- Typecheck passed. `createProductionAppTransportManager` / hopRuntime source tests: no relay, no `SimulatedNetwork`. `__DEV__` gates for debug ping, diagnostics, secret fail-closed. Release URL policy refuses localhost including `10.0.2.2`.

**Why not full credit**

- No device crash/soak. No TestFlight.

### BLE / hybrid transport — **12 / 15** (0)

Authenticated handshake is tested in-process. One-phone diagnostics expose adapter/GATT/handshake **state labels only**. **Still no two-phone radio proof.** The hardware-locked points stay locked.

### PTT / voice — **3 / 5** (0)

Unchanged software evidence. **Mic/playback/transport/queue not tested on phones.**

### Testing & observability — **4 / 5** (0)

Protocol **195** / API **74** / mobile typecheck / production-readiness gate. Extra tests are counted in deployment/mobile, not a bump here: still no E2E, device farm, or live Prometheus.

### Deployment readiness — **5 / 5** (0)

Unchanged 5/5 software ceiling from Phase 6. `apps/api/fly.toml` + `docs/FLY_DEPLOYMENT.md` are prep only — no public TLS host was contacted. A live host cannot add points here and does not unlock internet-messaging credit (that is core/backend) until an external HTTPS URL is actually tested.

---

## Phase 7 end-of-phase block

### CURRENT VERIFIED SCORE

**72 / 100**

| Category | Score |
|---|---|
| Core messaging reliability | 14 / 20 |
| Security & privacy | 14 / 20 |
| Backend/API production readiness | 11 / 15 |
| Mobile application stability | 9 / 15 |
| BLE / hybrid transport | 12 / 15 |
| PTT / voice | 3 / 5 |
| Testing & observability | 4 / 5 |
| Deployment readiness | 5 / 5 |
| **Total** | **72 / 100** |

This is **not** production-ready. It is **not** > 90. No major product features.

### WHAT INCREASED THE SCORE

- **+0** this phase. Fly.io files and docs are not a live host. Score stays 72.
- Hardware, live HTTPS, FS, BLE, PTT, TestFlight: still 0.

### WHAT PREVENTS 90+

- No physical iPhone + Android BLE proof (BLE cannot go to 15/15).
- No two-device internet soak against a **live non-localhost HTTPS** API.
- PTT not hardware-proven.
- Identity still unattested TOFU; no forward secrecy; lost key → new account.
- No TestFlight/EAS `projectId`. No Fly (or other) public HTTPS URL was reachable from this environment.

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
| Protocol | `cd packages/protocol && npm test -- --run` | **195 passed**, 0 failed (27 files) |
| API | `cd apps/api && .venv/bin/pytest` | **74 passed**, 0 failed |
| Mobile | `cd apps/mobile && npm run typecheck` | **passed** |
| Gate | `bash scripts/production-readiness-gate.sh` | **passed** (software only) |

No test fakes a physical BLE session. Internet protocol tests mock HTTP. API tests use `TestClient`. Local prod-mode startup is not live HTTPS.

### PHYSICAL TESTS STILL REQUIRED

Unchanged from Phase 4/5 (see `HOP_PHASE7_REPORT.md`, `docs/IOS_DEVICE_TESTING.md`, `docs/BLE_TESTING.md`). Until recorded pass/fail, do not raise BLE to 15/15, do not give PTT full credit, and do not give internet messaging full credit.

---

*Phase 7 stopped pending a Fly.io account, payment method, and secrets. Waiting for approval before any merge to `dev`.*
