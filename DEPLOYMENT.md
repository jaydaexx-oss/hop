# HOP deployment

**Generic VPS + Docker (no vendor lock-in):** `docs/PRODUCTION_DEPLOYMENT.md` and `.env.production.example`.

The rest of this file is a Hostinger-oriented walkthrough of the same Compose stack (`infra/docker-compose.prod.yml`). The application does not require Hostinger.

---


> **Do not run production deploy commands until you have reviewed `infra/.env`, DNS, and firewall settings.** This repository does not auto-deploy. Every step below is manual and requires your confirmation on the VPS.

## Architecture

```text
Internet :443/:80
    ↓
 Nginx (TLS, WebSocket upgrade, rate-limit friendly proxy headers)
    ↓
 FastAPI (hop-api container, Alembic migrations on start)
    ↓
 PostgreSQL + Redis (internal Docker network only)
```

Mobile clients should set `EXPO_PUBLIC_API_URL=https://<API_DOMAIN>`.

---

## 1. VPS setup

### Order a Hostinger VPS

1. Choose a **KVM** plan (KVM 2 or higher is comfortable for Postgres + Redis + API).
2. Select **Ubuntu 24.04 LTS**.
3. Note the VPS public IPv4 address.

### DNS

Create an **A record** pointing your API hostname to the VPS IP, for example:

| Type | Name | Value |
|---|---|---|
| A | `api` | `<VPS_IP>` |

Wait for DNS propagation before requesting TLS certificates.

### First login & hardening

SSH as root (or the sudo user Hostinger created):

```bash
ssh root@<VPS_IP>
apt update && apt upgrade -y
timedatectl set-timezone UTC
```

Create a deploy user (recommended):

```bash
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy/
```

### Firewall

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

Do **not** expose Postgres (`5432`) or Redis (`6379`) publicly. The production compose file keeps them on an internal network.

---

## 2. Docker installation

On Ubuntu 24.04:

```bash
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker deploy
```

Log out and back in so group membership applies.

Verify:

```bash
docker --version
docker compose version
```

---

## 3. Environment variables

On the VPS, clone the repository:

```bash
sudo mkdir -p /opt/hop
sudo chown deploy:deploy /opt/hop
git clone https://github.com/<your-org>/hop.git /opt/hop
cd /opt/hop/infra
cp .env.example .env
chmod 600 .env
```

Edit `infra/.env` and replace **every** placeholder:

| Variable | Purpose |
|---|---|
| `API_DOMAIN` | Public API hostname (`api.example.com`) |
| `API_PUBLIC_URL` | Must be `https://<API_DOMAIN>` — production refuses HTTP and localhost |
| `LETSENCRYPT_EMAIL` | Email for certificate expiry notices |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Database credentials (**generate a strong password**) |
| `CORS_ORIGINS` | Comma-separated allowed web/mobile origins (`https://app.example.com`) |
| `APP_VERSION` | Release tag shown in `/version` |
| `DOCS_ENABLED` | Keep `false` in production |
| `LOG_LEVEL` / `LOG_FORMAT` | `INFO` + `json` recommended |
| `UVICORN_WORKERS` | Start with `2` on a 2 vCPU VPS |
| `BACKUP_RETENTION_DAYS` | Local backup retention on disk |

**Never commit `infra/.env`.** Do not reuse example passwords.

Generate a Postgres password:

```bash
openssl rand -base64 32
```

---

## 4. Database setup

Production Postgres runs inside Docker with:

- Data volume: `hop_pgdata`
- Config: `infra/postgres/postgresql.conf`
- Backups directory: `infra/backups/`

Migrations run automatically when the API container starts (`alembic upgrade head` in `apps/api/scripts/entrypoint.sh`). Production **does not** call SQLModel `create_all` (Alembic is the only schema source). Nginx and the API reject bodies larger than **256 KiB**. Rate limits use Redis; if Redis is down in production the API returns **503** instead of silently widening to per-process memory.

Manual migration (if needed):

```bash
cd /opt/hop/infra
docker compose --env-file .env -f docker-compose.prod.yml run --rm api alembic upgrade head
```

Verify readiness after deploy:

```bash
curl -sS https://<API_DOMAIN>/ready | jq
# expect: {"status":"ready","database":"ok","redis":"ok",...}
```

---

## 5. SSL (HTTPS)

HOP uses **Let's Encrypt** with the `certbot` compose profile and Nginx `webroot` validation.

### 5.1 Bootstrap on HTTP

The default `infra/nginx/conf.d/hop-api.conf` serves HTTP and ACME challenges. Ensure DNS points to the VPS, then start the stack:

```bash
cd /opt/hop/infra
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
```

Confirm HTTP works:

```bash
curl -I http://<API_DOMAIN>/health
```

### 5.2 Obtain certificate

```bash
cd /opt/hop/infra
chmod +x scripts/*.sh
./scripts/obtain-certificate.sh
```

Or manually:

```bash
docker compose --env-file .env -f docker-compose.prod.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  -d "${API_DOMAIN}" \
  --email "${LETSENCRYPT_EMAIL}" \
  --agree-tos --no-eff-email
```

### 5.3 Enable HTTPS Nginx config

Render the SSL config (replace domain in template):

```bash
cd /opt/hop/infra
sed "s/YOUR_API_DOMAIN/${API_DOMAIN}/g" nginx/conf.d/hop-api.ssl.conf > nginx/conf.d/hop-api.conf
docker compose --env-file .env -f docker-compose.prod.yml exec nginx nginx -t
docker compose --env-file .env -f docker-compose.prod.yml exec nginx nginx -s reload
```

Verify:

```bash
curl -I https://<API_DOMAIN>/health
```

### 5.4 Renewal

Add a monthly cron job on the VPS:

```bash
crontab -e
# 03:15 on the 1st of each month UTC
15 3 1 * * cd /opt/hop/infra && ./scripts/renew-certificate.sh >> /var/log/hop-certbot.log 2>&1
```

---

## 6. Deployment

> **Stop and confirm** `infra/.env`, DNS, and firewall before running these commands.

```bash
cd /opt/hop/infra
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
docker compose --env-file .env -f docker-compose.prod.yml ps
```

Smoke tests:

```bash
curl -sS https://<API_DOMAIN>/health
curl -sS https://<API_DOMAIN>/ready
curl -sS https://<API_DOMAIN>/version
```

Configure the mobile app:

```bash
EXPO_PUBLIC_API_URL=https://<API_DOMAIN>
```

WebSocket URL: `wss://<API_DOMAIN>/ws` (first-frame auth — see `docs/API.md`).

### Optional: Prometheus monitoring profile

```bash
docker compose --env-file .env -f docker-compose.prod.yml --profile monitoring up -d
```

Prometheus listens on `127.0.0.1:9090` (SSH tunnel only):

```bash
ssh -L 9090:127.0.0.1:9090 deploy@<VPS_IP>
```

---

## 7. Updates

```bash
cd /opt/hop
git fetch origin
git checkout <release-tag-or-branch>
cd infra
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
docker compose --env-file .env -f docker-compose.prod.yml ps
curl -sS https://<API_DOMAIN>/ready
```

Watch logs during rollout:

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs -f api nginx
```

Alembic runs on API container start. If a migration fails, the new API container will not become healthy.

---

## 8. Backups

### On-demand backup

```bash
cd /opt/hop/infra
docker compose --env-file .env -f docker-compose.prod.yml --profile backup run --rm backup
ls -lh backups/
```

Backups are gzip SQL dumps: `backups/hop-YYYYMMDDTHHMMSSZ.sql.gz`.

### Scheduled backups (cron)

```bash
crontab -e
# Daily at 02:30 UTC
30 2 * * * cd /opt/hop/infra && docker compose --env-file .env -f docker-compose.prod.yml --profile backup run --rm backup >> /var/log/hop-backup.log 2>&1
```

Copy backups off the VPS (Hostinger snapshots, S3, rsync, etc.). **A VPS disk failure without off-site backups loses all messages.**

### Restore (destructive)

```bash
cd /opt/hop/infra
docker compose --env-file .env -f docker-compose.prod.yml stop api
docker compose --env-file .env -f docker-compose.prod.yml run --rm \
  -e PGHOST=postgres -e PGUSER="$POSTGRES_USER" -e PGPASSWORD="$POSTGRES_PASSWORD" -e PGDATABASE="$POSTGRES_DB" \
  -v "$PWD/backups:/backups" -v "$PWD/scripts/restore-postgres.sh:/restore-postgres.sh:ro" \
  postgres:16-alpine /bin/sh /restore-postgres.sh /backups/hop-YYYYMMDDTHHMMSSZ.sql.gz
docker compose --env-file .env -f docker-compose.prod.yml up -d api
```

Review `infra/scripts/restore-postgres.sh` before running against production.

---

## 9. Rollback

### Application rollback

```bash
cd /opt/hop
git log --oneline -5
git checkout <previous-good-commit-or-tag>
cd infra
docker compose --env-file .env -f docker-compose.prod.yml up -d --build
```

### Database rollback

Prefer **restore from backup** (section 8). Alembic downgrade is not maintained for every release — do not run `alembic downgrade` in production unless you have tested the path.

### Emergency: stop traffic

```bash
cd /opt/hop/infra
docker compose --env-file .env -f docker-compose.prod.yml stop nginx api
```

---

## 10. Monitoring

| Signal | How |
|---|---|
| **Liveness** | `GET /health` or `/live` — 200 means process up |
| **Readiness** | `GET /ready` — 200 when Postgres + Redis OK; 503 otherwise |
| **Metrics** | `GET /metrics` — Prometheus text format |
| **Logs** | `docker compose ... logs -f api nginx postgres redis` |
| **Container health** | `docker compose ... ps` — `(healthy)` status |
| **Prometheus** | Optional `--profile monitoring` (localhost `9090`) |
| **Hostinger panel** | CPU/RAM/disk graphs, VPS snapshots |

Recommended alerts (via Prometheus/Grafana or an external uptime checker):

- `/ready` non-200 for > 2 minutes
- Nginx or API container restart loop
- Disk > 85% on `/var/lib/docker`
- Certificate expiry < 14 days (Certbot emails + manual check)

### Log format

Production defaults to JSON logs on stdout (`LOG_FORMAT=json`). View with:

```bash
docker compose --env-file .env -f docker-compose.prod.yml logs api --tail=200
```

Do not log message plaintext or private keys. HOP API logs HTTP metadata only.

---

## Local production dry-run (optional)

On a developer machine with Docker:

```bash
cd infra
cp .env.example .env   # fill POSTGRES_PASSWORD at minimum
docker compose --env-file .env -f docker-compose.prod.yml up --build
```

Use HTTP bootstrap config only unless you have a real domain pointing at your machine.

---

## Files reference

| Path | Purpose |
|---|---|
| `infra/docker-compose.prod.yml` | Production stack |
| `infra/docker-compose.yml` | Local dev stack |
| `infra/.env.example` | Production env template |
| `infra/nginx/` | Nginx main + site configs |
| `infra/scripts/` | Backup, restore, certbot helpers |
| `docs/API.md` | HTTP/WebSocket API reference |
| `apps/api/Dockerfile` | API image |

## Support checklist before going live

- [ ] Strong unique `POSTGRES_PASSWORD` in `infra/.env`
- [ ] DNS A record for `API_DOMAIN`
- [ ] UFW allows 22, 80, 443 only
- [ ] HTTPS certificate issued and Nginx SSL config active
- [ ] `/ready` returns 200
- [ ] Mobile `EXPO_PUBLIC_API_URL` uses `https://`
- [ ] Backups scheduled and tested restore once
- [ ] `DOCS_ENABLED=false` in production
