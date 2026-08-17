# Fly.io deployment (recommended Phase 7 host)

**Recommended provider:** Fly.io  
**Why:** FastAPI already has a Docker image; Fly runs that image, terminates TLS on `https://<app>.fly.dev` (no DNS purchase for the first public URL), and talks to Postgres + Redis on the private network. Compose on a VPS remains valid (`docs/PRODUCTION_DEPLOYMENT.md`) but needs a VM, DNS, and Certbot. Render’s always-on web + Postgres + Redis is typically ~$24/month; Fly unmanaged Postgres + a small API machine is usually cheaper.

This file is **not** proof that HOP is live on HTTPS. There is no Fly token in this repository. Do not put secrets in git.

---

## Honest cost (always-on, low traffic)

Fly is pay-as-you-go. A **credit card is required**. Do not use Fly **Managed Postgres** (Basic ~$38/month) for this phase.

| Piece | What to provision | Rough monthly |
|---|---|---|
| API | 1× shared-cpu-1x, 512 MB, always on (`min_machines_running = 1`) | ~$3–5 |
| Postgres | `fly postgres create` (unmanaged cluster), 1 GB volume | ~$5–10 |
| Redis | `fly redis create` (Upstash) or a tiny Redis machine | ~$0–5 (Upstash free tier possible) |
| TLS / `*.fly.dev` | Included; shared IPv4/Anycast | $0 |
| Dedicated IPv4 | Optional (only if you need it) | ~$2–4 |
| **Total** | Always-on API + Postgres + Redis | **about $10–18** |

Sleeping the API (`auto_stop_machines`) would cut compute but breaks a messaging `/ready` + WebSocket target. This config keeps one machine running.

---

## Database and storage

| Store | Production | Why |
|---|---|---|
| **PostgreSQL** | Required | `assert_production_config` rejects `sqlite`. `UVICORN_WORKERS=2` cannot share SQLite. |
| **Alembic** | Required | `apps/api/scripts/entrypoint.sh` runs `alembic upgrade head`. Do not rewrite the ORM. Local pytest may keep sqlite. |
| **Redis** | Required | `/ready` and rate limits. Loopback Redis is rejected in production. |
| **SQLite on Fly** | **Not supported** | Machine root disk is ephemeral. A Fly volume for a sqlite file still fails production config and multi-worker locking. |

---

## Required environment

Non-secret defaults live in `apps/api/fly.toml` `[env]`. **Secrets** (never commit):

| Variable | How |
|---|---|
| `DATABASE_URL` | `postgresql+psycopg://USER:PASSWORD@HOST:5432/DB` — not sqlite, not localhost. `fly postgres attach` may set `postgres://`; if boot fails, re-set with the `postgresql+psycopg://` prefix. Do not paste the URL into chat. |
| `REDIS_URL` | Private Redis URL from `fly redis` / Upstash (`redis://` or `rediss://`). Not localhost. |
| `API_PUBLIC_URL` | `https://<your-app>.fly.dev` |
| `CORS_ORIGINS` | Explicit HTTPS allow-list, not `*`. Native mobile does not use CORS; use the API origin itself (restrictive). |

Already set in `fly.toml` (edit the hostname if your app name is not `hop-api`): `APP_ENV=production`, `DOCS_ENABLED=false`, `TRUST_PROXY_HEADERS=true`, `FORWARDED_ALLOW_IPS=*`, `UVICORN_WORKERS=2`, `LOG_FORMAT=json`.

---

## Exact procedure (after you have a Fly account)

Nothing below can be completed in this environment without **your** Fly login and card. Run these on your machine. Do not send passwords or connection strings back in chat; reply that the app exists and the public URL is reachable.

### 0. Account (STOP until done)

1. Create an account: [https://fly.io/app/sign-up](https://fly.io/app/sign-up)
2. Add a payment method when Fly asks (required for orgs).
3. Install CLI and log in:

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

Use the org you just created. Do not authorize this agent to bill you.

### 1. Repo

```bash
cd /path/to/hop
git fetch origin
git checkout integration/production-stabilization
git pull origin integration/production-stabilization
cd apps/api
```

### 2. Unique app name

`hop-api` may already be taken. Create yours, then edit `apps/api/fly.toml`: `app`, `API_PUBLIC_URL`, and `CORS_ORIGINS` must match `https://<your-app>.fly.dev`.

```bash
fly apps create hop-api
# if taken: fly apps create hop-api-<suffix>
# then edit fly.toml before deploy
```

### 3. Postgres (unmanaged — not MPG)

```bash
fly postgres create --name hop-db --region sjc \
  --initial-cluster-size 1 \
  --vm-size shared-cpu-1x \
  --volume-size 1
fly postgres attach hop-db --app hop-api
```

Attach sets `DATABASE_URL`. Confirm names only (no values):

```bash
fly secrets list --app hop-api
```

If the URL scheme is `postgres://`, set the psycopg URL yourself (generate from the Fly dashboard or `fly postgres config`, **do not paste it into git or chat**):

```bash
fly secrets set DATABASE_URL='postgresql+psycopg://USER:PASSWORD@HOST:5432/DB' --app hop-api
```

### 4. Redis

```bash
fly redis create --name hop-redis --region sjc --no-replicas --enable-eviction
fly redis attach hop-redis --app hop-api
```

If `fly redis` is unavailable, create a small Redis app in the same org and set `REDIS_URL` to its private `.internal` host. Do not publish port 6379 on the internet.

### 5. Public URL secrets (if not already in fly.toml)

```bash
fly secrets set \
  API_PUBLIC_URL='https://hop-api.fly.dev' \
  CORS_ORIGINS='https://hop-api.fly.dev' \
  --app hop-api
```

Replace `hop-api` with your app name. Restrictive CORS: one HTTPS origin, not `*`.

### 6. Deploy

```bash
cd apps/api
fly deploy
```

Alembic runs in `entrypoint.sh` on boot. `GET /health` is the Fly check (process up). `GET /ready` is Postgres + Redis.

### 7. Smoke (you run; then reply to continue Phase 7 live tests)

```bash
curl -sS https://<your-app>.fly.dev/health
curl -sS https://<your-app>.fly.dev/ready
curl -sS https://<your-app>.fly.dev/version
```

Expect `/health` 200, `/ready` 200 with `database=ok` and `redis=ok`. Then reply with **only** the public `https://…fly.dev` hostname (no secrets). Mobile: `EXPO_PUBLIC_API_URL=https://<your-app>.fly.dev`.

This repo’s live app is `hop-uokqmg` (`https://hop-uokqmg.fly.dev`). Set `apps/mobile/.env` from `.env.example`. Do not create or deploy `hop-api`.

---

## What this does not do

- No merge to `dev` or `main`.
- No TestFlight / EAS `projectId`.
- No BLE or PTT hardware proof.
- No custom domain required for the first HTTPS proof (`*.fly.dev` is enough).
