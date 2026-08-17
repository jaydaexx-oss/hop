# Production deployment (generic VPS + Docker)

**Canonical software path for a live HTTPS API on a VPS.** This is not a paid-host lock-in. Any Ubuntu (or similar) VPS with Docker Compose, a DNS name, and a TLS terminator works.

**Phase 7 recommended host:** Fly.io — `docs/FLY_DEPLOYMENT.md` and `apps/api/fly.toml`. Lowest-friction public HTTPS (`https://<app>.fly.dev`) for FastAPI + Postgres + Redis without buying DNS first. Persistent SQLite is not supported on Fly. Cost and the account/card STOP are in that doc.

Vendor-specific Hostinger notes remain in the repo-root `DEPLOYMENT.md`. Compose file: `infra/docker-compose.prod.yml`. Env template: `.env.production.example` (this repo) and `infra/.env.example`.

**Do not treat this document as proof that HOP is live on HTTPS.** Filling env vars and reading Compose is not a deploy. A local production-mode process startup (`APP_ENV=production` with generated test secrets) is **local validation only**. A committed `fly.toml` is not a live host.

---

## Architecture

```text
Internet :443 (and :80 for ACME)
    ↓
 Reverse proxy (Nginx in this repo) — TLS, WebSocket upgrade, body cap
    ↓
 hop-api (uvicorn, HTTP on the internal Docker network only)
    ↓
 PostgreSQL + Redis (internal network; not published)
```

The API process **listens HTTP inside the compose network**. HTTPS is required at the **public** URL (`API_PUBLIC_URL`). Production startup **refuses** to boot if `API_PUBLIC_URL` is missing, HTTP, localhost, or `CHANGE_ME`.

Mobile release builds (`__DEV__ === false`) refuse localhost, `127.0.0.1`, and plain HTTP. Development clients may use RFC1918 LAN HTTP to a Mac running the API. See `docs/IOS_DEVICE_TESTING.md`.

---

## Required environment variables

Copy `.env.production.example` to a gitignored file (`infra/.env` on the VPS). Replace every `CHANGE_ME`. Never commit real secrets.

| Variable | Required | Production rule |
|---|---|---|
| `APP_ENV` | yes | `production` (compose sets this) |
| `API_PUBLIC_URL` | yes | `https://<API_DOMAIN>` — not HTTP, not localhost |
| `API_DOMAIN` | yes | Public hostname for Nginx / certificates |
| `DATABASE_URL` | yes (or compose-built) | PostgreSQL. Not sqlite. Not localhost. Not `CHANGE_ME` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | yes | Compose builds `DATABASE_URL` from these |
| `REDIS_URL` | yes (or compose-built) | Not localhost. Not `CHANGE_ME` |
| `CORS_ORIGINS` | yes | Explicit HTTPS allow-list. Not `*`. Not localhost. Not HTTP |
| `DOCS_ENABLED` | yes | `false` |
| `LETSENCRYPT_EMAIL` | yes if using the certbot profile | Certificate notices |
| `APP_VERSION` | recommended | Shown on `/version` |
| `LOG_LEVEL` / `LOG_FORMAT` | recommended | `INFO` + `json` |
| `UVICORN_WORKERS` | recommended | `2` or more — **requires Postgres**, not sqlite |
| `TRUST_PROXY_HEADERS` | compose sets `true` | Nginx must overwrite `X-Forwarded-For` |

Optional: `METRICS_ENABLED`, `RATE_LIMIT_AUTH`, `RATE_LIMIT_MESSAGE`, `HTTP_PORT`, `HTTPS_PORT`, `BACKUP_RETENTION_DAYS`, `FORWARDED_ALLOW_IPS`.

Missing required secrets **fail closed** at API start (`assert_production_config`). There is no `CHANGE_ME` Settings default in application code.

---

## Database: SQLite vs Postgres

**Do not rewrite the database this phase.**

| Context | Engine | Why |
|---|---|---|
| Local API tests / laptop validation | SQLite (`sqlite://` or a file) | `apps/api/tests/conftest.py`. `create_all` on startup. Fine for single-process pytest. |
| Mobile offline queue | sql.js in protocol tests; `expo-sqlite` on device | Not the API database. Device process-kill still unproven. |
| Production API | **PostgreSQL 16** | `infra/docker-compose.prod.yml`. Alembic `001_initial` on container start (`apps/api/scripts/entrypoint.sh`). `create_all` is skipped when `APP_ENV=production`. |

SQLite is **unsuitable for multi-worker production**:

- Compose defaults `UVICORN_WORKERS=2`. Workers do not share SQLite locks or in-process `StaticPool`.
- Production config **rejects** `DATABASE_URL` starting with `sqlite`.
- Rate limits and sessions need a shared store (Redis + Postgres), not per-process memory.

**Requirement:** Postgres + Alembic. Already wired in compose. Local sqlite remains OK for automated validation.

Restart / duplicate / transaction evidence (automated, not a live Postgres soak):

- Protocol: queued message survives restart; duplicate inbound `message_id` dropped (`offlineSync.test.ts`, `phase4Reliability.test.ts`).
- API: duplicate `message_id` is 409 with `IntegrityError` rollback (`test_authz.py`); duplicate username 409 (`test_auth.py`); identity unique pk 409 (`test_identity_adversarial.py`).

---

## Reproducible HTTPS hosting (generic)

1. Ubuntu (or similar) VPS. Docker Engine + Compose plugin. UFW: 22, 80, 443 only. Do not publish 5432 or 6379.
2. DNS A record: `API_DOMAIN` → VPS IPv4. Wait for propagation.
3. Clone this repo. `cp .env.production.example infra/.env` (or `infra/.env.example`). Fill secrets (`openssl rand -base64 32` for Postgres).
4. Bootstrap HTTP, obtain a certificate (Let's Encrypt webroot is in `infra/scripts/obtain-certificate.sh`), switch Nginx to the SSL template (`infra/nginx/conf.d/hop-api.ssl.conf`).
5. `cd infra && docker compose --env-file .env -f docker-compose.prod.yml up -d --build`
6. Smoke: `curl -sS https://$API_DOMAIN/health` and `/ready`. Expect `/ready` `database=ok` and `redis=ok`.
7. Mobile: `EXPO_PUBLIC_API_URL=https://$API_DOMAIN`. Release builds refuse anything else.

This repository does **not** auto-deploy. Do not point this phase at a paid host from CI.

---

## Health and logs

| Endpoint | Meaning |
|---|---|
| `GET /health` | Process up |
| `GET /live` | Liveness |
| `GET /ready` | Postgres + Redis |
| `GET /version` | `APP_VERSION` + env |
| `GET /metrics` | Prometheus text (disable with `METRICS_ENABLED=false`) |

Access logs are method/path/status/duration + `X-Request-ID`. Bodies, keys, plaintext, `crypto_box`, and voice are not logged. Unhandled errors return a generic detail in production.

---

## What this does not prove

- Live non-localhost HTTPS in the environment that wrote this file (Fly.toml is not a deploy).
- Two-phone BLE.
- PTT on hardware.
- EAS `projectId` / TestFlight / App Store.
