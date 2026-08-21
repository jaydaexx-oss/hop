# HOP

Privacy-first hybrid messenger. **Messages find a way.**

Chat send chooses internet or BLE automatically. Nearby BLE and internet chat both use libsodium `crypto_box` (X25519 + XSalsa20-Poly1305). Controlled peer-relay is **simulated** (A→B→C→D tests); real-world mesh is **not** complete.

**Production stabilization:** see [`HOP_STABILIZATION_MODE.md`](./HOP_STABILIZATION_MODE.md). No new major features until verified score > 90/100.

## Status (honest)

| Area | Status |
|---|---|
| Register, login, logout, username profile | Implemented, API tested |
| 1:1 chats over the internet | Opaque `crypto_box` payloads; server cannot read plaintext |
| WebSocket realtime | First-frame token auth (no query-string tokens) |
| Delivery status (sent / delivered / read) | Implemented, API tested |
| Alembic `001_initial` | Implemented (not applied to a live Postgres here) |
| TransportManager + InternetTransport | Implemented, unit tested (internet/BLE/neither/both + fallback) |
| SQLite local DB, offline queue, retry/backoff, reconnect sync | Implemented, protocol-tested (file DB restart) |
| Nearby BLE proof of concept | Implemented in code; **not verified on a physical iPhone and Android phone** |
| Nearby BLE encrypted message | libsodium `crypto_box` in code; protocol-tested; **not verified on hardware** |
| Controlled peer-relay | Protocol simulator (A→B→C→D); **physical mesh not complete** |
| BLE / relay / mesh routing | Simulator only — do not claim real-world mesh |
| Internet E2EE | libsodium `crypto_box`; server stores ciphertext only. Identity keys are client-published, not CA-attested |
| Docker / production deploy | Compose prod stack + `DEPLOYMENT.md` (Hostinger VPS guide) |

## Layout

```text
apps/mobile     Expo / React Native / TypeScript
apps/api        FastAPI / Python
packages/protocol   Shared message + transport types
infra           docker-compose (dev + prod), Nginx, backups
DEPLOYMENT.md   Hostinger VPS production guide
docs/API.md     HTTP/WebSocket API reference
.github/workflows   CI
docs
```

## Run tests

```bash
cd packages/protocol && npm test
cd apps/api && pytest
cd apps/mobile && npm run typecheck
```

## Run locally

API (SQLite, no Docker):

```bash
cd apps/api
source .venv/bin/activate
pip install -r requirements-test.txt
pip install uvicorn
DATABASE_URL=sqlite:///./hop.db CORS_ORIGINS=http://localhost:8081 \
  uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` is required so a physical iPhone on your LAN can reach the API. Simulator-only use can stay on 127.0.0.1.

To clear the **network/IP** new-account test limiter on this local API (`APP_ENV=development`), not production:

```bash
cd apps/api
npm run reset:account-creation-limits
# same as: curl -sS -X POST http://127.0.0.1:8000/auth/dev/reset-account-creation-limits
```

That curl uses the **Mac's** source IP. It does **not** clear an iPhone pointed at `https://hop-uokqmg.fly.dev`. The script refuses `hop-uokqmg.fly.dev`. For a physical phone, set `EXPO_PUBLIC_API_URL=http://<MAC_LAN_IP>:8000`, restart Metro, and use the hidden 7-tap diagnostics reset on the phone.

Postgres migrations (when Postgres is running):

```bash
cd apps/api
alembic upgrade head
```

Mobile (development client — **not Expo Go**):

```bash
cp apps/mobile/.env.example apps/mobile/.env
# Default in .env.example is the live Fly API: https://hop-uokqmg.fly.dev
# LAN API instead: EXPO_PUBLIC_API_URL=http://<MAC_LAN_IP>:8000
cd apps/mobile
npm install
npx expo prebuild --platform ios
npx expo run:ios --device
```

Install steps, signing, and diagnostics: **`docs/IOS_DEVICE_TESTING.md`**. Nearby BLE procedure: **`docs/BLE_TESTING.md`**. Simulators, Expo Go, and web are not valid BLE tests.

Android emulator: `EXPO_PUBLIC_API_URL=http://10.0.2.2:8000`.

## Production deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for Hostinger VPS setup (Docker, Nginx, HTTPS, Postgres, Redis, backups, monitoring). **Do not deploy until you have reviewed `infra/.env` and DNS.**

API reference: **[docs/API.md](./docs/API.md)**.

## Next recommended step

Confirm Nearby BLE encrypted send on a physical iPhone and Android phone (`docs/BLE_TESTING.md`). Do not add mesh yet. Internet E2EE uses libsodium `crypto_box`; identity keys are still client-published and not hardware-verified.
