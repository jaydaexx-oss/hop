# Implementation status

Updated after controlled peer-relay (protocol simulator). Physical multi-device mesh is **not** complete.

| Item | Status | Tested |
|---|---|---|
| Register / login / logout | Implemented | API tests |
| User profile / username | Implemented | API tests + settings UI |
| 1:1 conversation create | Implemented | API tests |
| Internet message send | Implemented | API tests |
| WebSocket realtime | Implemented | API websocket test |
| Delivery status SENT/DELIVERED/READ | Implemented | API tests |
| Client `message_id` idempotency | Implemented | API test |
| PostgreSQL models | Implemented | create_all in tests |
| Alembic migration `001_initial` | Implemented | Revision head test (upgrade not run against Postgres here) |
| SQLite local database | Implemented (`HopSqliteStore`) | Protocol file-DB restart test |
| Local message persistence | Implemented | Protocol restart test |
| Offline outbound queue | Implemented | Protocol restart + backoff tests |
| Message state machine | Implemented | Protocol + API tests |
| Retry + exponential backoff | Implemented | Protocol backoff test |
| Sync when connectivity returns | Implemented | Protocol restart/sync test |
| Duplicate `message_id` protection | Implemented | Protocol + in-memory TransportManager tests |
| Expo chat UI + offline send path | Implemented | Typecheck only (no simulator/device) |
| Nearby BLE PoC (scan, advertise, connect, chunked payload) | Implemented in code | **Not verified on physical devices** |
| Nearby BLE secure session + `crypto_box` payload + ack/retry | Implemented in code | Protocol unit tests + mobile typecheck; **not verified on physical devices** |
| TransportManager internet/BLE selection + fallback | Implemented | Protocol unit tests (availability matrix + fallback) |
| Controlled peer-relay (A→B→C, consent, hops, TTL, loops) | Implemented in protocol simulator | Protocol simulator tests; **not verified on physical devices** |
| Internet E2EE | libsodium `crypto_box`; opaque server storage | API + protocol tests |
| Identity public key publish | Implemented (`PUT /users/me/identity`) | API tests |
| Rate limits (in-process) | Implemented | Unit + API 429 test |
| Blocked users | Enforced on conversation create | API tests |
| Real-world BLE mesh / multi-hop | **Not complete** | Simulator only; phones untested |
| Docker / live Postgres / Redis | Configured | Docker not installed; Redis not running |

## Tested vs untested

**Tested in this environment**

- Protocol unit tests (63 passed): crypto_box, sender-id bind, TOFU, opaque internet transport, A→B→C / A→B→C→D relay simulator
- Mobile `tsc --noEmit`

**Not tested in this environment**

- Any physical iPhone ↔ Android BLE session
- Physical A→B→C or A→B→C→D
- Handshake `pk` over real GATT
- Encrypted send, decrypt, ack, timeout, retry, or relay on hardware
- Internet-off BLE path on hardware
- Expo Go / simulators / web (invalid for BLE)

Chat send goes `MessageService → TransportManager`. Relay details: `docs/RELAY.md`. Real-world mesh is **not** complete.
