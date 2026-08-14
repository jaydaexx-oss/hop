# HOP architecture

Core promise: **Messages find a way.** The user does not pick a transport.

```text
MessageService
      ↓
TransportManager
      ↓
Selected Transport (internet | bluetooth | relay | local)
```

Messaging code must not import Bluetooth native APIs. `MessageService` / `TransportManager` talk to `BluetoothTransport`, which calls a `BleLink`. The Expo app implements `HopBleEngine` behind that interface.

## Modules

```text
Mobile App
├── UI
├── State
├── Messaging
├── Crypto          (libsodium crypto_box on Nearby BLE only; internet still alg: none)
├── Storage         (SQLite local DB + outbound queue)
├── TransportManager
│   ├── InternetTransport
│   ├── BluetoothTransport  (BLE PoC; recipient-mapped; needs physical-device verification)
│   ├── RelayTransport      (stub — mesh not implemented)
│   └── LocalTransport      (in-memory)
└── Device Services
    └── HopBleEngine (scan, advertise, connect; Nearby only)
```

## Selection order

TransportManager chooses a route. The user never picks one.

1. Internet, if the API is reachable
2. Direct BLE, if that recipient is nearby (handshake `user_id` mapped)
3. Local queue (SQLite in the app; in-memory `LocalTransport` in protocol tests)

If internet is selected but send fails, BLE is tried next. Relay/mesh is **not** selected.

## Message lifecycle

`CREATED → ENCRYPTED → QUEUED → SENDING → SENT → RELAYING → DELIVERED → READ`

Failure: `FAILED` | `EXPIRED`

Illegal transitions are rejected.

## Envelope

`message_id` (CSPRNG UUID v4), `sender_id`, `recipient_id`, `conversation_id`, `encrypted_payload`, `created_at`, `expires_at`, `ttl`, `hop_count`, `transport`, `status`

Duplicates are dropped by `message_id`. Relays stop when `hop_count >= 8` or `now >= expires_at`.

## Backend

FastAPI + PostgreSQL + Redis + WebSockets. Alembic `001_initial` exists; tests use SQLite `create_all`. Ciphertext only on `messages.encrypted_payload` — no plaintext body column. Client `message_id` is accepted so offline retries are idempotent.

## Crypto

Do not invent protocols.

- **Nearby BLE (this PoC):** libsodium `crypto_box` (X25519 + XSalsa20-Poly1305). Session = GATT connect + exchange of long-term public keys in handshake v2. Not Signal Protocol. Not a ratchet.
- **Internet chat:** still `alg: none` over TLS.
- **Production later:** evaluate Signal Protocol. Not started.
