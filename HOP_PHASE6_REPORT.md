# HOP Phase 6 Production Stabilization Report

**Branch:** `integration/production-stabilization`  
**Date:** 2026-08-16  
**Crypto:** libsodium `crypto_box` / `crypto_auth` / `crypto_box_beforenm` unchanged. **Forward secrecy: option B (defer).**  
**BLE hardware:** still **UNVERIFIED**. One-phone diagnostics are technical state only. This phase does not claim radios work.  
**Live HTTPS:** **not proven**. Local production-mode process startup is not a public TLS host.

Phase 6 stops here pending approval. This branch is pushed to origin only. It is **not** merged to `dev` or `main`. Legacy branches were not touched. Phase 1–5 security is preserved.

---

## 1. Scope

Stabilization-only live-deployment *readiness*: production URL/HTTPS fail-closed, sanitized errors, Postgres-vs-sqlite documentation, generic VPS/Docker deploy docs, release-build transport gates, `__DEV__` one-phone diagnostics, expanded iPhone checklist, local prod-mode startup test. No Event Mode, mesh, group PTT, live calls, social, or monetization. No paid-host deploy.

## 2. Production backend

`assert_production_config` now requires `API_PUBLIC_URL`: HTTPS, not localhost / `127.0.0.1` / `0.0.0.0`, not `CHANGE_ME`, not empty. Existing gates remain: secrets from env, no Settings `CHANGE_ME` defaults, sqlite rejected, CORS explicit HTTPS allow-list, Redis not loopback. `/health` and `/ready` unchanged. Request IDs and redaction (Phase 5) kept; `voice` / `crypto_box` keys added to redact maps. Unhandled errors return a generic detail in production (`client_error_payload`). Compose passes `API_PUBLIC_URL`.

Tests: HTTP public URL rejected; `https://127.0.0.1` rejected; missing URL rejected; generated-secret subprocess TestClient startup with `APP_ENV=production` serves `/health`, hides `/docs`, hits `/ready` (503 without real Postgres/Redis). **Not live HTTPS.**

## 3. Database

No schema rewrite. Local sqlite remains OK for pytest and laptop validation. Production compose already uses PostgreSQL 16 + Alembic (`entrypoint.sh` `alembic upgrade head`; `create_all` skipped in production). SQLite is unsuitable for `UVICORN_WORKERS>=2` (no shared `StaticPool` across processes). Restart/duplicate/transaction evidence is existing protocol + API tests (queued restart, duplicate `message_id` 409, IntegrityError rollback). Documented in `docs/PRODUCTION_DEPLOYMENT.md`.

## 4. Deployment config

Created `docs/PRODUCTION_DEPLOYMENT.md` and `.env.production.example` (placeholders only). `DEPLOYMENT.md` now points at the generic guide; Hostinger remains one walkthrough of the same Compose file. `infra/.env.example` and `infra/docker-compose.prod.yml` include `API_PUBLIC_URL`.

## 5. Mobile production config

Release (`isDev: false`) still refuses localhost (including `10.0.2.2` and `https://localhost`) and cleartext HTTP. `__DEV__` still allows RFC1918 LAN HTTP. Tests cover emulator loopback in release. `createAppTransportManager` delegates to `createProductionAppTransportManager` (internet, bluetooth, local). Nearby debug ping, diagnostics, and identity memory fallback remain `__DEV__`-gated.

## 6. Physical iPhone test mode

`docs/IOS_DEVICE_TESTING.md` expanded as **development-device validation**, not a product feature: account, identity, internet messaging, encrypt/decrypt, persistence, PTT record/encrypt/send/play, BT/mic/local-network permissions. No production backdoors.

## 7. One-phone BLE diagnostics

`HopBleEngine.diagnosticsSnapshot()` + Device diagnostics (`__DEV__` only): BT permission, adapter, advertising, scanning, GATT registration, connection count, MTU if returned, handshake phase, transport selected, fallback reason. Strings that look like secrets/ciphertext/voice are omitted. **Not two-phone proof.**

## 8. Release build audit

Automated: `createProductionAppTransportManager` registers only `internet` / `bluetooth` / `local`; hopRuntime source must not import `SimulatedNetwork`, `createRelayTransport`, or `defaultTransportManager`; `__DEV__` gates on debug ping, diagnostics, secret fail-closed. `eas.json` production/preview still `developmentClient: false`. No `ble-debug` screen on this branch.

## 9. Deployment dry run

Local only: production-like env with `secrets.token_urlsafe` passwords; subprocess ASGI TestClient; `/health` 200; OpenAPI off; `/ready` 503 without live Postgres/Redis. Dev TestClient still proves sqlite `/ready` database=ok. **Do not claim live HTTPS.**

## 10. Score (evidence-based)

Previous verified score **70 / 100**. Phase 6 **72 / 100**. Hardware-locked BLE/PTT/live-HTTPS points stay locked. Docs without tests do not add points. Deployment category is now at its software ceiling (5/5); remaining product gaps are phones, public TLS, identity, and FS.

---

## A. VERIFIED SCORE /100

**72 / 100** (previous: **70 / 100**)

| Category | Phase 5 | Phase 6 | Delta |
|---|---|---|---|
| Core messaging reliability | 14 / 20 | 14 / 20 | 0 |
| Security & privacy | 14 / 20 | 14 / 20 | 0 |
| Backend/API production readiness | 11 / 15 | 11 / 15 | 0 |
| Mobile application stability | 8 / 15 | 9 / 15 | +1 |
| BLE / hybrid transport | 12 / 15 | 12 / 15 | 0 |
| PTT / voice | 3 / 5 | 3 / 5 | 0 |
| Testing & observability | 4 / 5 | 4 / 5 | 0 |
| Deployment readiness | 4 / 5 | 5 / 5 | +1 |
| **Total** | **70** | **72** | **+2** |

Not production-ready. Not > 90. No major product features.

## B. Previous score

**70 / 100** (`HOP_STABILIZATION_MODE.md` Phase 5).

## C. Exact points gained + evidence

| Points | Why (evidence, not “code exists”) |
|---|---|
| **+1 deployment (4→5/5)** | Production `API_PUBLIC_URL` HTTP and localhost rejected by tests; missing URL fail-closed; local `APP_ENV=production` process startup serves `/health`, disables docs. Compose still **not** executed against Let’s Encrypt. No public host. Category is at the software max; live TLS cannot add more here. |
| **+1 mobile (8→9/15)** | `releaseBuildGuards.test.ts` proves `createProductionAppTransportManager` does not register `relay`; hopRuntime source has no `SimulatedNetwork` / `createRelayTransport`; `__DEV__` gates for debug ping, diagnostics, secret fail-closed; release URL policy includes emulator loopback. **No device crash/soak.** |
| **0 backend** | Extra production gates are deployment-config tests. No live Postgres+Redis+HTTPS in this environment. Stays 11/15. |
| **0 BLE** | Diagnostics snapshot is one-phone software state. MockBleLink tests unchanged. Hardware-locked points stay locked. |
| **0 PTT / core / security / testing** | No new hardware, no FS, no E2E farm. Protocol 190→195 is the five release-guard tests, not a testing-category bump (still no E2E/device farm). |
| **0 FS** | Option B. |

## D. Protocol / API / mobile / dependency counts

| Suite | Command | Result |
|---|---|---|
| Protocol | `cd packages/protocol && npm test -- --run` | **195 passed**, 0 failed (27 files) |
| API | `cd apps/api && .venv/bin/pytest` | **74 passed**, 0 failed |
| Mobile | `cd apps/mobile && npm run typecheck` | **passed** |
| Gate | `bash scripts/production-readiness-gate.sh` | **passed** (software only) |
| Mobile npm audit | `cd apps/mobile && npm audit` | **22** (14 high / 8 moderate / 0 critical); Expo/Metro/`uuid` transitives — see `docs/MOBILE_DEPENDENCY_SECURITY.md`. No `--force`. |

One Phase 4 concurrent-send assertion flaked once under load (`SENT`+`QUEUED`); full re-run and the gate run were green. Not treated as a new P0.

## E. Remaining P0 / P1

Unchanged P0: unattested TOFU; lost-key new-account dead end; no two-phone BLE; no live non-localhost HTTPS; no EAS `projectId` / TestFlight.

P1: no FS; first GATT pk still TOFU; ephemeral plaintext playback file; Expo toolchain audit noise; QR / safety-number UI not built.

## F. What requires one physical iPhone

Development client install (Xcode or EAS development profile), LAN or HTTPS API reachability, permissions (BT / mic / local network), account+identity, sqlite persistence across kill, PTT record/play on device, one-phone BLE adapter/advertise/scan/GATT rows. Checklist: `docs/IOS_DEVICE_TESTING.md`. Does **not** prove two-phone BLE or live HTTPS.

## G. What requires two physical phones

Encrypted Nearby send/receive, authenticated handshake over GATT, MTU/chunking on air, ACK, KEY_CHANGED on radio, internet-down BLE fallback. Procedure: `docs/BLE_TESTING.md`. Diagnostics on one phone are not a substitute.

## H. What requires Apple Developer membership

TestFlight, App Store, EAS `production` / store distribution, a durable `projectId`. A free Apple ID can often run a USB development client (short-lived signature) but cannot ship TestFlight.

## I. What requires a live HTTPS host

DNS + TLS terminator + Postgres + Redis as in `docs/PRODUCTION_DEPLOYMENT.md`. Two-device internet soak against a **non-localhost** `https://` API. Release mobile `EXPO_PUBLIC_API_URL`. This environment did not do that.

## J. Estimated score after live HTTPS validation

From **72**, if a real non-localhost HTTPS API with Postgres+Redis passes `/ready` and two clients exchange boxed messages: about **76–78** (core ~16/20, backend ~13/15). Deployment is already 5/5. Still not 90.

## K. Estimated score after one-phone validation

From **72**, if the iOS checklist passes on a development client (LAN HTTP allowed): about **75–76** (mobile ~11/15, PTT ~4/5 if record/play works). BLE stays 12. LAN HTTP is not live HTTPS.

## L. Estimated score after two-phone BLE validation

From **72**, if `docs/BLE_TESTING.md` passes on two physical phones: about **74** (BLE ~14/15). Background BLE is still off, so 15/15 stays out of reach.

## M. Shortest path to >90

Stack live HTTPS soak + two-phone BLE + one-phone PTT + TestFlight/`projectId` + a device crash soak. That still lands around **the mid-80s** while identity is unattested TOFU and FS is option B (security capped well below 20). Clearing **90** also needs identity beyond client-published TOFU (QR/safety-number at minimum; attestation if claiming production E2EE) and probably a longer two-device soak. Hardware alone does not get there.

---

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

- **+1 deployment:** `API_PUBLIC_URL` HTTPS/localhost reject tests + local production-mode `/health` startup. Not a live host. Category now 5/5 software ceiling.
- **+1 mobile:** release-build tests that the app send path does not register relay/sim and that debug BLE/diagnostics/secret fallback stay `__DEV__`-gated. No phone soak.
- **0** phones, live HTTPS, FS, BLE hardware, PTT hardware.

### WHAT PREVENTS 90+

- No physical iPhone + Android BLE proof (BLE cannot go to 15/15).
- No two-device internet soak against a **live non-localhost HTTPS** API.
- PTT not hardware-proven.
- Identity still unattested TOFU; no forward secrecy; lost key → new account.
- No TestFlight / EAS `projectId`. Deployment *docs* exist; public TLS was not applied here.

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
| Gate | `bash scripts/production-readiness-gate.sh` | **passed** (software only; no hardware claim) |

No test fakes a physical BLE session. Internet protocol tests mock HTTP. API tests use `TestClient`. Local prod-mode startup is not live HTTPS.

### PHYSICAL TESTS STILL REQUIRED

Unchanged hardware list from Phase 4/5 (`docs/BLE_TESTING.md`, `docs/IOS_DEVICE_TESTING.md`). Until recorded pass/fail, do not raise BLE to 15/15, do not give PTT full credit, and do not give internet messaging full credit. One-phone diagnostics are not two-phone proof.

---

*Phase 6 complete. Waiting for approval before any merge to `dev`.*
