# HOP architecture

Core promise: **Messages find a way.** The user never picks a transport.

This document is the system design. It describes both **what exists in the repo today** and **what we will build incrementally**. Nothing here is a claim that a feature works unless the status table says it is implemented and tested.

Related:

- [ROADMAP.md](./ROADMAP.md)
- [SECURITY.md](./SECURITY.md)
- [BLE.md](./BLE.md)

---

## 1. System architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                        Mobile app                           │
│  UI → MessageService → TransportManager → Transport         │
│                         │                                   │
│              SQLite + secure key storage                    │
└─────────────┬───────────────────┬───────────────────────────┘
              │ Internet          │ BLE / local / relay
              ▼                   ▼
     FastAPI + Postgres +     Nearby HOP devices
     Redis + WebSockets       (ciphertext only)
```

**Non-negotiable dependency rule**

```text
MessageService
      ↓
TransportManager
      ↓
Selected Transport
```

`MessageService` must not import Bluetooth, GATT, or Core Bluetooth. BLE lives only inside `BluetoothTransport`.

**Transport selection (automatic)**

1. Internet — recipient reachable via API / WebSocket
2. Local LAN — future; not in v1 (see platform risks)
3. Direct BLE — peer discovered nearby
4. Relay — only if that peer enabled “Help relay encrypted messages”
5. Local queue — persist, backoff, retry; never an infinite loop

**Process topology (backend)**

```text
Client ──HTTPS──► FastAPI
Client ──WSS────► FastAPI ──pub/sub──► Redis
FastAPI ────────► PostgreSQL
```

Hostinger VPS is the first host, not an architecture dependency. Services are named generically (`api`, `postgres`, `redis`) so the stack can move to another provider.

| Layer | Status |
|---|---|
| Diagram / this design | Specified |
| Working end-to-end messaging | **Not implemented** |

---

## 2. Folder structure

### Current (implemented)

```text
hop/
├── apps/
│   ├── mobile/                 # Expo Router tab shell (UI only)
│   └── api/                    # FastAPI skeleton + SQLModel classes
├── packages/
│   └── protocol/               # Message model, state machine, TransportManager
├── infra/
│   └── docker-compose.yml      # Postgres, Redis, API (not executed here)
└── docs/
```

### Target (do not create all of this in one pass)

```text
hop/
├── apps/mobile/
│   ├── app/                    # Expo Router: Chats, Nearby, Contacts, Settings
│   ├── src/
│   │   ├── messaging/          # MessageService + lifecycle
│   │   ├── crypto/             # Established libraries only
│   │   ├── storage/            # SQLite + secure storage
│   │   ├── transport/          # RN adapters wrapping @hop/protocol
│   │   └── device/             # Permissions, battery, connectivity
│   └── modules/                # Native Swift / Kotlin BLE (dev client)
├── apps/api/
│   ├── app/api/                # auth, users, devices, conversations, messages, acks, sync, push
│   ├── app/ws/                 # realtime
│   ├── app/models/
│   ├── app/services/
│   └── alembic/                # migrations (not started)
├── packages/protocol/          # Shared types; messaging must depend on this, not on BLE
└── infra/
```

`packages/protocol` is the source of truth for envelopes, statuses, and the `Transport` interface. Python mirrors the state machine for server-side validation.

---

## 3. Mobile architecture

**Stack:** React Native + TypeScript + Expo **development builds** (not Expo Go). Native Swift/Kotlin modules where BLE or background rules require them.

**UI (source exists, untested on device)**

| Tab | User-facing role | Implementation |
|---|---|---|
| Chats | Conversations | Placeholder |
| Nearby | Nearby HOP users by display name | Placeholder |
| Contacts | People the user chose to add | Placeholder |
| Settings | Relay consent, appearance, devices | Placeholder |

Show only: `Online | Nearby | Offline | Queued | Relaying | Synchronizing`. No GATT, MTU, MAC, or hop-count jargon in the UI.

**Runtime layers (mostly not implemented)**

| Module | Responsibility | Status |
|---|---|---|
| UI | Navigation, dark/light, a11y | Partial (tab shell) |
| State | Conversation list, send pipeline | **Not implemented** |
| MessageService | Create → encrypt → enqueue | **Not implemented** |
| Crypto | libsodium first; Signal later | **Not implemented** |
| Storage | SQLite + Keychain/Keystore | **Not implemented** |
| TransportManager | In `@hop/protocol` | Implemented, unit tested |
| Device | Permissions, scan duty cycle | **Not implemented** |

Expo Go cannot host HOP BLE. Production-like BLE requires `expo-dev-client` plus native modules.

---

## 4. Backend architecture

**Stack:** Python, FastAPI, PostgreSQL, Redis, WebSockets. Docker for local/VPS. Env-based config (no secrets in git).

**Intended HTTP/WS surface**

| Area | Role | Status |
|---|---|---|
| `GET /health` | Liveness | Implemented, tested |
| Auth | Register / login / sessions | **501 stub** |
| Users | Profile handle, not a phone dump | **501 stub** |
| Devices | Public identity key per device | **501 stub** |
| Conversations | Membership only | **501 stub** |
| Messages | Ciphertext envelopes | **501 stub** |
| Acks | Delivery / read | **501 stub** |
| Sync | Catch-up after offline | **501 stub** |
| Push | APNs / FCM device tokens | **501 stub** |
| WebSockets | Live delivery + coarse presence | **Not implemented** |

The API is a **delivery and sync plane**, not a place to read message bodies. If E2EE is on, Postgres stores `encrypted_payload` only.

**Cloud-agnostic rules**

- No Hostinger-specific APIs in application code
- Object storage, if added later, behind an interface
- `DATABASE_URL` / `REDIS_URL` only

---

## 5. Database architecture

### PostgreSQL (server)

Modeled as SQLModel classes. **Migrations and live DB access are not implemented.**

| Table | Purpose | Must not store |
|---|---|---|
| `users` | Handle, timestamps | Phone/email unless user opts in later |
| `devices` | Platform + identity **public** key | Private keys |
| `conversations` | Conversation id | |
| `conversation_members` | Membership | |
| `messages` | Envelope + ciphertext | Plaintext body |
| `message_delivery` | Per-device delivery state | |
| `sessions` | Auth token **hash** | Raw tokens |
| `blocked_users` | Blocks | |
| `reports` | Abuse reports | Message plaintext |

**Metadata minimization (later):** prefer opaque ids over phone numbers; do not store GPS; do not store BLE MACs (iOS will not give them anyway). `sender_id` on a stored envelope is already metadata — treat it as sensitive.

### SQLite (device)

**Not implemented.** Required for offline:

- Messages and conversations
- Outbound queue
- Statuses
- Processed `message_id`s (must survive process death)
- Nearby cache (display name + ephemeral peer id, never MAC)
- Sync cursor

The app must remain usable when the server is unreachable.

### Redis

Intended for WebSocket fan-out, short-lived presence, and rate limits. **Not a source of truth.** Not wired.

---

## 6. Transport abstraction

Defined in `packages/protocol`. Messaging talks only to `TransportManager`.

```text
Transport
  id, isAvailable(), send(envelope), subscribe(), status()

InternetTransport     stub — not implemented
BluetoothTransport    stub — not implemented
RelayTransport        stub — not implemented
LocalTransport        partial — in-memory queue, not SQLite
```

**Priority:** `internet → bluetooth → relay → local`.

**Guarantees already tested in protocol unit tests**

- Empty / plaintext payload is refused
- Duplicate `message_id` is discarded and not forwarded
- Expired envelopes are not sent
- Exponential backoff returns `null` after `maxAttempts` (no infinite retry)
- When other transports are down, LocalTransport queues and status is `Queued`

**Not implemented:** timer-driven retry, sync-when-online, BLE/Internet handoff, relay hop increment.

Relay devices must forward **opaque envelopes** only. They cannot decrypt. Forwarding stops when `hop_count >= MAX_HOPS` (8) or `now >= expires_at`.

---

## 7. Message lifecycle

Every message has:

`message_id` (CSPRNG UUID v4), `sender_id`, `recipient_id`, `conversation_id`, `encrypted_payload`, `created_at`, `expires_at`, `ttl`, `hop_count`, `transport`, `status`

**Happy path**

```text
CREATED → ENCRYPTED → QUEUED → SENDING → SENT → RELAYING → DELIVERED → READ
```

`SENDING → QUEUED` is legal (retry). `RELAYING → RELAYING` is legal (another hop).

**Terminal failure:** `FAILED` | `EXPIRED` — no exit.

Illegal transitions throw. Python and TypeScript machines must stay aligned.

**Offline path (specified, not implemented end-to-end)**

```text
Create → Encrypt → Store locally → Try transports → Queue → Backoff → Sync when a path returns
```

---

## 8. BLE architecture

See [BLE.md](./BLE.md). Summary:

- BLE is a **transport**, not the messenger
- First milestone is **direct** encrypted A → B on **physical** iPhone + Android
- No mesh until that works
- Simulators do not count
- Never send plaintext over BLE
- Background BLE on iOS is the highest platform risk; we document and degrade honestly rather than fake a mesh

---

## 9. Security architecture

See [SECURITY.md](./SECURITY.md). Summary:

- Do not invent cryptographic protocols
- Phase 1: libsodium (X25519 + XChaCha20-Poly1305)
- Production: evaluate Signal Protocol (`libsignal`)
- Relays cannot decrypt
- Keys in Keychain / Android Keystore, not SQLite
- Threats: MITM, replay, impersonation, malicious relays, injection, spam/DoS, metadata leakage, lost devices

E2EE is **not implemented**.

---

## 10. Testing strategy

Never call a feature complete if it is mocked, simulated, or simulator-only when the spec requires hardware.

| Layer | What | Status |
|---|---|---|
| Unit | Create, transitions, queue, retry, duplicates, TTL, encrypt (later) | Partial (no crypto yet) |
| API | `/health`, 501 stubs, Python state machine | Partial |
| Integration | Internet→Internet, BLE→BLE, Offline→Queue→Internet, BLE→Internet | **Not implemented** |
| Mesh | BLE→BLE→BLE | **Forbidden until direct BLE works** |
| Device | Physical iPhone + Android for BLE | **Not implemented** |

Protocol: `packages/protocol` vitest (15 tests, passing as of skeleton).  
API: `apps/api` pytest (6 tests, passing as of skeleton).  
Expo app: **not run** (install blocked by disk on the original machine).

---

## Platform risks (iOS / Android)

These are design constraints, not tickets to “work around” by faking behavior.

### High — will shape the product

| Risk | Platforms | Honest approach |
|---|---|---|
| Background BLE advertise/scan is tightly limited; iOS may rewrite advertisement data | iOS ≫ Android | Foreground Nearby is the supported path; background is best-effort; UI says `Nearby` only when it is actually true |
| Dual role (central + peripheral) is flaky on some chipsets | Both | PoC is one advertiser + one scanner first, then swap roles |
| Expo Go cannot load custom BLE native code | Both | Dev client + Swift/Kotlin required |
| Android 12+ BLE permissions vs older location permission | Android | Runtime permission matrix by API level; never scan without grant |
| Android 14+ foreground-service types for connected devices | Android | Declare the correct FGS type or do not claim background BLE |
| OEM battery killers (Xiaomi, Huawei, etc.) | Android | Document; do not promise background relay on those devices |
| Local LAN / mDNS needs Local Network permission; Multipeer is iOS-only | Both | Defer LAN transport; do not use iOS-only APIs for a cross-platform path |
| ATT MTU is small (often 20–512 bytes) | Both | Chunk ciphertext; reassemble before decrypt |
| Clock skew vs `expires_at` | Both | Prefer TTL + expiry; do not require perfect NTP for BLE |

### Medium

| Risk | Notes |
|---|---|
| iOS `bluetooth-peripheral` background mode is App Review sensitive | Only request it when we have a real peripheral use case |
| iOS will not expose Bluetooth MAC | Good for privacy; Nearby uses a rotating HOP peer id + display name |
| Android scan without `neverForLocation` can imply location collection | Set `neverForLocation` if we do not need location; do not collect GPS for Nearby |
| Push (APNs/FCM) is required when the app is killed and BLE is dead | Internet path, not BLE |
| Keychain / Keystore access around lock screen | Crypto ops may fail until unlocked; queue, do not crash |
| IPv6-only networks / NAT64 | Internet transport must not assume IPv4 |

### Product / privacy

| Risk | Notes |
|---|---|
| Envelope `sender_id` leaks social graph to relays and the server | Minimize; pad/size later; never put names in the BLE advertisement |
| Processed-ID set in RAM is lost on kill | Must move to SQLite or duplicates will reappear |
| Simultaneous internet + BLE can double-deliver | Duplicate `message_id` drop is the safety net — must persist |

---

## What this repo is not

HOP is not yet a messenger. Chats, Nearby discovery, encryption, SQLite, Internet delivery, and BLE are **not implemented**. Stubs that return “not implemented” are intentional.
