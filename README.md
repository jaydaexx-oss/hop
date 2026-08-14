# HOP

Privacy-first hybrid messenger. **Messages find a way.**

First usable internet chat is in place. Chat send chooses internet or BLE automatically. Nearby BLE can exchange a libsodium `crypto_box` application message in code and has **not** been verified on hardware here. Mesh is **not** implemented. Internet chat is still `alg: none`.

## Status (honest)

| Area | Status |
|---|---|
| Register, login, logout, username profile | Implemented, API tested |
| 1:1 chats over the internet | Implemented, API tested |
| WebSocket realtime | Implemented, API tested |
| Delivery status (sent / delivered / read) | Implemented, API tested |
| Alembic `001_initial` | Implemented (not applied to a live Postgres here) |
| TransportManager + InternetTransport | Implemented, unit tested (internet/BLE/neither/both + fallback) |
| SQLite local DB, offline queue, retry/backoff, reconnect sync | Implemented, protocol-tested (file DB restart) |
| Nearby BLE proof of concept | Implemented in code; **not verified on physical iPhone/Android** |
| Nearby BLE encrypted message | libsodium `crypto_box` in code; protocol-tested; **not verified on hardware** |
| BLE / relay / mesh routing | **Mesh not implemented** |
| Internet E2EE | **Not implemented** — internet bodies are `alg: none` over TLS |
| Docker / Redis | Compose files only; Docker not installed |

## Layout

```text
apps/mobile     Expo / React Native / TypeScript
apps/api        FastAPI / Python
packages/protocol   Shared message + transport types
infra           docker-compose (Postgres, Redis, API)
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
DATABASE_URL=sqlite:///./hop.db CORS_ORIGINS=* uvicorn app.main:app --reload --port 8000
```

Postgres migrations (when Postgres is running):

```bash
cd apps/api
alembic upgrade head
```

Mobile:

```bash
cp .env.example .env
cd apps/mobile
npm install
npx expo start --dev-client
```

Nearby BLE requires a **development build** on a physical iPhone and Android phone. Expo Go, simulators, and web are not valid BLE tests. Exact steps: `docs/BLE_TESTING.md`.

Android emulator: `EXPO_PUBLIC_API_URL=http://10.0.2.2:8000`.

## Next recommended step

Confirm Nearby BLE encrypted send on a physical iPhone and Android phone (`docs/BLE_TESTING.md`). Do not add mesh yet. Internet E2EE is still `alg: none`.
