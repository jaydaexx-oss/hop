# HOP Phase 7 Production Stabilization Report

**Branch:** `integration/production-stabilization`  
**Date:** 2026-08-16  
**Crypto:** libsodium `crypto_box` / `crypto_auth` / `crypto_box_beforenm` unchanged. **Forward secrecy: option B (defer).**  
**BLE hardware:** still **UNVERIFIED**.  
**Live HTTPS:** **NOT VERIFIED.** No public URL was contacted. No Fly/Render/Railway credentials exist in this environment.

Phase 7 **STOPS** here. Hosting files are prepared. Live deploy requires the user to create a Fly.io account, add a payment method, and set secrets. This branch is pushed to origin only. It is **not** merged to `dev` or `main`. Legacy branches were not touched. Phase 1–6 security is preserved. No plaintext secrets in logs or git.

---

## 1. Recommended host

| # | Decision |
|---|---|
| **Provider** | **Fly.io** |
| **Why it fits HOP** | Existing FastAPI Docker image; automatic TLS on `https://<app>.fly.dev` (no DNS purchase for the first public proof); Postgres + Redis on the private network; always-on machine for `/ready` and WebSockets. |
| **Estimated cost** | **~$10–18/month** always-on: API shared-cpu-1x 512 MB ~$3–5, unmanaged `fly postgres create` ~$5–10, Redis/Upstash ~$0–5. **Do not** use Fly Managed Postgres (Basic ~$38). Credit card required. |
| **Database / storage** | **PostgreSQL** + existing Alembic (`entrypoint.sh` `alembic upgrade head`). **Redis** required (`/ready`, rate limits). |
| **Required env** | Secrets: `DATABASE_URL` (`postgresql+psycopg://…`), `REDIS_URL`, `API_PUBLIC_URL`, `CORS_ORIGINS` (explicit HTTPS, not `*`). Non-secrets in `apps/api/fly.toml`: `APP_ENV=production`, `DOCS_ENABLED=false`, `TRUST_PROXY_HEADERS=true`, `UVICORN_WORKERS=2`. |
| **Persistent SQLite** | **No.** Fly machine disk is ephemeral. Production already rejects `sqlite`. Multi-worker (`UVICORN_WORKERS=2`) cannot share SQLite. |
| **Procedure** | `docs/FLY_DEPLOYMENT.md` (exact commands after you have an account). |

Not chosen: **Render** (~$24/month for always-on web + Postgres + Redis; free web sleeps). **Railway** (GitHub OAuth typical; similar hobby cost). **VPS + Compose** remains documented (`docs/PRODUCTION_DEPLOYMENT.md`) but needs DNS + Certbot; worse for a first HTTPS proof.

No ORM rewrite. Local pytest sqlite is unchanged.

---

## 2. Repo prep (this phase)

- `apps/api/fly.toml` — HTTP service port 8000, `force_https`, `/health` check, 512 MB VM, restrictive CORS placeholder `https://hop-api.fly.dev`.
- `docs/FLY_DEPLOYMENT.md` — cost, SQLite limits, secrets, deploy steps.
- `.env.production.example` — Fly secret placeholders (commented). No real secrets.
- Pointers in `DEPLOYMENT.md`, `docs/PRODUCTION_DEPLOYMENT.md`, `infra/.env.example`.
- `.gitignore` includes `.fly/`.

---

## 3. Live deploy status

| Check | Result |
|---|---|
| Fly/Render/Railway CLI | **Not installed** |
| Auth / API tokens | **None** |
| `API_PUBLIC_URL` in env | **Unset** |
| External `GET /health` | **Not run** (no URL) |
| External `GET /ready` | **Not run** |
| TLS | **Not verified** |
| Persistence (live Postgres) | **Not verified** |

**LIVE HTTPS NOT VERIFIED.** No URL was invented.

---

## 4. Score (evidence-based)

Previous verified score **72 / 100** (Phase 6). Phase 7 **72 / 100**. Docs and config **do not** add points. Unproven HTTPS **does not** add backend or core-messaging points. BLE / PTT / TestFlight / FS **not awarded**.

---

## A. VERIFIED SCORE /100

**72 / 100** (previous: **72 / 100**)

| Category | Phase 6 | Phase 7 | Delta |
|---|---|---|---|
| Core messaging reliability | 14 / 20 | 14 / 20 | 0 |
| Security & privacy | 14 / 20 | 14 / 20 | 0 |
| Backend/API production readiness | 11 / 15 | 11 / 15 | 0 |
| Mobile application stability | 9 / 15 | 9 / 15 | 0 |
| BLE / hybrid transport | 12 / 15 | 12 / 15 | 0 |
| PTT / voice | 3 / 5 | 3 / 5 | 0 |
| Testing & observability | 4 / 5 | 4 / 5 | 0 |
| Deployment readiness | 5 / 5 | 5 / 5 | 0 |
| **Total** | **72** | **72** | **+0** |

Not production-ready. Not > 90. No major product features.

## B. Previous score

**72 / 100** (`HOP_PHASE6_REPORT.md`).

## C. Exact points gained + evidence

| Points | Why |
|---|---|
| **0** | Fly.toml + docs are not a live host. No external HTTPS URL was contacted. |

## D. Protocol / API / mobile / dependency counts

| Suite | Command | Result |
|---|---|---|
| Protocol | `cd packages/protocol && npm test -- --run` | **195 passed**, 0 failed (27 files) |
| API | `cd apps/api && .venv/bin/pytest` | **74 passed**, 0 failed |
| Mobile | `cd apps/mobile && npm run typecheck` | **passed** |
| Gate | `bash scripts/production-readiness-gate.sh` | **passed** (software only) |

## E. Remaining P0 / P1

Unchanged P0: unattested TOFU; lost-key new-account dead end; no two-phone BLE; no live non-localhost HTTPS; no EAS `projectId` / TestFlight.

P1: no FS; first GATT pk still TOFU; ephemeral plaintext playback file; Expo toolchain audit noise; QR / safety-number UI not built.

## F–I. Physical / Apple / live HTTPS

Unchanged from Phase 6. One-phone diagnostics are not two-phone proof. Live HTTPS still requires a reachable non-localhost `https://` API (`docs/FLY_DEPLOYMENT.md`).

## J. Estimated score after live HTTPS validation

From **72**, if a real non-localhost HTTPS API with Postgres+Redis passes `/ready` and two clients exchange boxed messages: about **76–78** (core ~16/20, backend ~13/15). Deployment is already 5/5. Still not 90.

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

Nothing. **+0.** Fly.io prep is not live TLS.

### WHAT PREVENTS 90+

- No physical iPhone + Android BLE proof (BLE cannot go to 15/15).
- No two-device internet soak against a **live non-localhost HTTPS** API.
- PTT not hardware-proven.
- Identity still unattested TOFU; no forward secrecy; lost key → new account.
- No TestFlight / EAS `projectId`. Public TLS was not applied here.

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

No test fakes a physical BLE session. Internet protocol tests mock HTTP. API tests use `TestClient`. Fly.toml is not live HTTPS.

### PHYSICAL TESTS STILL REQUIRED

Unchanged hardware list (`docs/BLE_TESTING.md`, `docs/IOS_DEVICE_TESTING.md`). Until recorded pass/fail, do not raise BLE to 15/15, do not give PTT full credit, and do not give internet messaging full credit.

---

## STOP — user checklist (required before live HTTPS points)

This environment **cannot** create a Fly account, enter a card, or set secrets. After you finish the steps below, reply with **only** the public hostname (`https://<app>.fly.dev`) — **no passwords, no `DATABASE_URL`, no tokens**. Then live `/health` `/ready` tests can continue.

1. Create a Fly.io account: https://fly.io/app/sign-up  
2. Add a payment method when Fly requires it.  
3. Install CLI and log in:

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

4. On this repo:

```bash
cd /path/to/hop
git fetch origin
git checkout integration/production-stabilization
git pull origin integration/production-stabilization
cd apps/api
```

5. Create a **unique** app name if `hop-api` is taken. Edit `apps/api/fly.toml` (`app`, `API_PUBLIC_URL`, `CORS_ORIGINS`) to `https://<your-app>.fly.dev`.

```bash
fly apps create hop-api
```

6. Postgres (unmanaged — **not** Managed Postgres):

```bash
fly postgres create --name hop-db --region sjc \
  --initial-cluster-size 1 --vm-size shared-cpu-1x --volume-size 1
fly postgres attach hop-db --app hop-api
```

If attach stores `postgres://`, re-set `DATABASE_URL` as `postgresql+psycopg://…` locally (do not paste it into chat):

```bash
fly secrets set DATABASE_URL='postgresql+psycopg://USER:PASSWORD@HOST:5432/DB' --app hop-api
```

7. Redis:

```bash
fly redis create --name hop-redis --region sjc --no-replicas --enable-eviction
fly redis attach hop-redis --app hop-api
```

8. Public URL (match your app name):

```bash
fly secrets set \
  API_PUBLIC_URL='https://hop-api.fly.dev' \
  CORS_ORIGINS='https://hop-api.fly.dev' \
  --app hop-api
```

9. Deploy and smoke:

```bash
cd apps/api
fly deploy
curl -sS https://<your-app>.fly.dev/health
curl -sS https://<your-app>.fly.dev/ready
```

Expect `/ready` `database=ok` and `redis=ok`. Then reply with the public URL only.

Full detail: `docs/FLY_DEPLOYMENT.md`.

---

*Phase 7 stopped pending Fly.io account + secrets. Not merged to `dev`.*
