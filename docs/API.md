# HOP API

FastAPI backend for register/login, 1:1 conversations, opaque `crypto_box` message relay, delivery acks, and WebSocket push.

## Base URL

| Environment | URL |
|---|---|
| Local (no Docker) | `http://127.0.0.1:8000` (Simulator / this Mac). Bind `--host 0.0.0.0` for phones. |
| Physical iPhone (same Wi-Fi) | `http://<MAC_LAN_IP>:8000` — never `127.0.0.1` on the device. See `docs/IOS_DEVICE_TESTING.md`. |
| Local Docker | `http://127.0.0.1:8000` (dev compose) |
| Production | `https://hop-uokqmg.fly.dev` (Fly app `hop-uokqmg`, never `hop-api`) |

## Authentication

Most routes require `Authorization: Bearer <token>` from `/auth/register` or `/auth/login`.

WebSocket: connect to `/ws`, then send the first frame:

```json
{"type":"auth","token":"<session-token>"}
```

Do **not** put session tokens in query strings.

## Health & monitoring

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | No | Liveness — process is up |
| GET | `/live` | No | Alias liveness probe |
| GET | `/ready` | No | Readiness — Postgres + Redis (503 if not ready) |
| GET | `/version` | No | `{service, version, env}` — `env` is `APP_ENV`. Clients show **DEV** vs **PRODUCTION** from this field plus the API URL host (`hop-uokqmg.fly.dev` → PRODUCTION; localhost/LAN → DEV). |
| GET | `/metrics` | No | Prometheus text metrics (disable with `METRICS_ENABLED=false`) |

## Interactive documentation

When `DOCS_ENABLED=true` (default in development):

- Swagger UI: `/docs`
- ReDoc: `/redoc`
- OpenAPI JSON: `/openapi.json`

Production defaults to **docs disabled**. Set `DOCS_ENABLED=true` temporarily for debugging only.

## Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{username, password}` | `{token, user}` |
| POST | `/auth/login` | `{username, password}` | `{token, user}` |
| POST | `/auth/logout` | — | `{status:"ok"}` |

Rate limited (`429`) by client IP.

`POST /auth/register-device` also mints a new `user_id` and is limited to **3 / install / 24h** and **5 / network IP / 24h** (`Too many new accounts from this network`). Recovery routes (`/auth/recover/*`, handle lookup, passkey authenticate) do **not** use that mint limiter.

Hidden development-only `POST /auth/dev/reset-account-creation-limits` (omitted from OpenAPI) deletes the **request source IP** mint bucket and, if `X-Hop-Install` is sent, the install bucket. Enabled when `APP_ENV` is not production (or when both `ENABLE_DEV_RATE_LIMIT_RESET` and `DEV_RATE_LIMIT_RESET_KEY` are set — leave both unset on `hop-uokqmg`). Local copy-paste:

```bash
cd apps/api && npm run reset:account-creation-limits
# curl -sS -X POST http://127.0.0.1:8000/auth/dev/reset-account-creation-limits
```

The npm script refuses `https://hop-uokqmg.fly.dev`. A Mac curl cannot clear an iPhone’s IP. See `docs/IOS_DEVICE_TESTING.md`.

## Users

| Method | Path | Description |
|---|---|---|
| GET | `/users/me` | Current profile |
| PUT | `/users/me/identity` | Publish libsodium public key `{public_key}` (immutable after first publish) |
| GET | `/users/id/{user_id}` | Lookup user by UUID (requires auth; includes `identity_public_key`) |
| POST | `/users/me/blocks` | Block user `{username}` |
| GET | `/users/{username}` | Lookup user (requires auth) |

## Conversations & messages

| Method | Path | Description |
|---|---|---|
| POST | `/conversations` | Start/find 1:1 chat `{username}` |
| GET | `/conversations` | List chats |
| GET | `/conversations/{id}/messages` | List messages (non-expired, ciphertext only) |
| POST | `/conversations/{id}/messages` | Send `{encrypted_payload, message_id?}` — must be `crypto_box` |
| POST | `/messages/{id}/acks` | Recipient ack `{status:"DELIVERED"|"READ"}` |

## Realtime

| Protocol | Path | Notes |
|---|---|---|
| WebSocket | `/ws` | First-frame auth; `hello`, `message`, `ack` events |

## Stubs

`/devices` and `/sync` return **501** (not implemented).

`POST /push/register` returns **404**. Push notifications are **not offered**. The route is omitted from OpenAPI.

## Message payload format

Internet POST bodies must be JSON strings matching libsodium `crypto_box`:

```json
{
  "v": 1,
  "alg": "crypto_box_xsalsa20poly1305",
  "sender_pk": "<base64>",
  "nonce": "<base64>",
  "ciphertext": "<base64>"
}
```

The server stores and forwards this blob. It does **not** decrypt or return plaintext (`text` is always `null`, `e2ee` is `true`).

## Environment variables

See `infra/.env.example` (production) and root `.env.example` (local). Never commit filled `.env` files.

## Not implemented on the server

- Push notifications
- Multi-device sync API
- Server-side decryption
- Distributed rate limiting (in-process only today)
