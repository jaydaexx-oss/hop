# HOP roadmap

Build incrementally. Do not generate the entire app. Do not claim a feature works unless it is implemented and tested. Distinguish:

`Implemented` · `Tested` · `Simulated` · `Partially implemented` · `Not implemented` · `Blocked by platform`

## Current snapshot

Skeleton only. See [ARCHITECTURE.md](./ARCHITECTURE.md) and [docs/STATUS.md](./STATUS.md).

| Milestone | Status |
|---|---|
| 0 Architecture + repo | Implemented (this docs pass) |
| 1 Protocol + TransportManager + API health | Implemented, unit tested |
| 2 Expo tab shell (source) | Partially implemented (not run on a device) |
| 3+ Messaging, internet, BLE, E2EE | **Not implemented** |

## Ordered milestones

Each step is one logical slice: smallest testable change, tests, then stop.

### M0 — Architecture (this task)

Docs: architecture, roadmap, security, BLE. No major features.

### M1 — Skeleton (done)

Monorepo, protocol package, FastAPI `/health`, 501 stubs, in-memory `LocalTransport`, tab placeholders.

### M2 — Mobile runnable

Free disk / install Expo deps, run the four tabs on a simulator **for UI only**. Does not prove BLE.

### M3 — SQLite local store

Persist messages, queue, statuses, processed IDs. App usable with API down. Tests: queue survives process restart (as far as JS tests allow) + schema.

### M4 — Internet transport (no E2EE yet)

Still refuse empty payloads. Server stores ciphertext field (can be a placeholder ciphertext once crypto exists). WebSocket delivery. Integration: **Internet → Internet**.

Do not skip crypto for production traffic; for this milestone only, a clearly labeled **non-production** sealed blob is acceptable if documented as **not E2EE**. Prefer landing libsodium in the same milestone if it stays small.

### M5 — Device crypto (libsodium)

Encrypt before any transport. Unit: encrypt/decrypt. TransportManager already rejects empty payloads.

### M6 — Auth, devices, conversations

Handles, device public keys, sessions (hashed tokens). No contact-list upload.

### M7 — Offline sync

Create → encrypt → SQLite → backoff → sync when internet returns. Integration: **Offline → Queue → Internet**.

### M8 — BLE proof of concept (hardware)

See [BLE.md](./BLE.md). **Physical iPhone + physical Android.** Direct encrypted A → B only. Integration: **BLE → BLE**. Simulator success is not completion.

### M9 — Nearby UI

Display name + `Available` / `Relay enabled`. Never MAC, GPS, or raw hardware ids.

### M10 — BLE ↔ Internet handoff

Same `message_id` must not double-show. Integration: **BLE → Internet**.

### M11 — Relay consent + single hop

Settings toggle. Relays cannot decrypt. Stop on hop/TTL. **Not a mesh.**

### M12 — Production E2EE evaluation

Evaluate Signal Protocol (`libsignal`) or another audited library. Identity keys, sessions, rotation, safety-number / QR verification.

### M13 — Multi-hop `A → B → C → D`

Only after M8–M11 are real. Integration: **BLE → BLE → BLE**.

### M14 — Push + Hostinger deploy

APNs/FCM when the app is killed. Docker on VPS. Cloud-agnostic config.

### Explicitly later / maybe never in v1

- Local Wi-Fi / mDNS transport (cross-platform LAN is a platform minefield)
- Browser client
- Contact-book import without consent
- Advertising, analytics on message bodies, selling data

## What not to do next

- Mesh routing
- Polished chat UX before InternetTransport
- Inventing a crypto protocol
- Claiming BLE works from a simulator
- Large unrelated refactors
