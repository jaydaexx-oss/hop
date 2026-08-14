# HOP

Privacy-first hybrid messenger. **Messages find a way.**

This repository is an incremental skeleton. Features that are not implemented are labeled as such. Nothing here is a working messenger yet.

## Status (honest)

| Area | Status |
|---|---|
| Monorepo + git | Implemented |
| Message model + state machine | Implemented, unit tested |
| TransportManager abstraction | Implemented, unit tested |
| LocalTransport | Partially implemented (in-memory, not SQLite) |
| Internet / BLE / Relay transports | Not implemented (explicit stubs) |
| FastAPI `/health` | Implemented, unit tested |
| Auth, messages, sync APIs | Not implemented (HTTP 501) |
| Expo tab shell | Implemented (source only until `npm install`) |
| E2EE | Not implemented |
| BLE on physical devices | Not implemented |
| Docker Compose | Implemented as files; Docker is not installed on this machine |

## Layout

```text
apps/mobile     Expo / React Native / TypeScript
apps/api        FastAPI / Python
packages/protocol   Shared message + transport types
infra           docker-compose (Postgres, Redis, API)
docs            ARCHITECTURE, ROADMAP, SECURITY, BLE
```

## Run tests

Protocol:

```bash
cd packages/protocol
npm install
npm test
```

API (no Postgres required for current tests):

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-test.txt
pytest
```

API process:

```bash
cd apps/api
source .venv/bin/activate
uvicorn app.main:app --reload --port 8000
# GET http://127.0.0.1:8000/health
```

Mobile (after `npm install` in `apps/mobile`):

```bash
cd apps/mobile
npx expo start
```

Docker (when Docker is installed):

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
- [docs/SECURITY.md](docs/SECURITY.md)
- [docs/BLE.md](docs/BLE.md)

## Next recommended step

See [docs/ROADMAP.md](docs/ROADMAP.md). Do not start BLE or mesh until Internet + local persistence are real, except as a later dedicated milestone.
