# HOP architecture

Core promise: **Messages find a way.** The user does not pick a transport.

```text
MessageService
      ↓
TransportManager
      ↓
Selected Transport (internet | bluetooth | relay | local)
```

Messaging code must not import Bluetooth.

## Modules

```text
Mobile App
├── UI
├── State
├── Messaging
├── Crypto          (not implemented)
├── Storage         (SQLite not implemented)
├── TransportManager
│   ├── InternetTransport   (stub)
│   ├── BluetoothTransport  (stub)
│   ├── RelayTransport      (stub)
│   └── LocalTransport      (in-memory)
└── Device Services
```

## Selection order

1. Internet, if the recipient is reachable
2. Local LAN (future stub — not in v1)
3. Direct BLE, if nearby
4. Relay, only with user consent
5. Local queue

## Message lifecycle

`CREATED → ENCRYPTED → QUEUED → SENDING → SENT → RELAYING → DELIVERED → READ`

Failure: `FAILED` | `EXPIRED`

Illegal transitions are rejected.

## Envelope

`message_id` (CSPRNG UUID v4), `sender_id`, `recipient_id`, `conversation_id`, `encrypted_payload`, `created_at`, `expires_at`, `ttl`, `hop_count`, `transport`, `status`

Duplicates are dropped by `message_id`. Relays stop when `hop_count >= 8` or `now >= expires_at`.

## Backend

FastAPI + PostgreSQL + Redis + WebSockets. Tables are modeled; migrations and live DB access are not implemented. Ciphertext only on `messages.encrypted_payload` — no plaintext body column.

## Crypto

Do not invent protocols. First encryption milestone: libsodium. Production: evaluate Signal Protocol. Not started.
