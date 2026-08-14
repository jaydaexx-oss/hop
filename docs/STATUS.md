# Implementation status

Updated after Nearby BLE encrypted application messages (libsodium `crypto_box`). Mesh relay is **not** implemented.

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
| Internet E2EE | **Not implemented** (`alg: none`) | Documented |
| BLE mesh / multi-hop relay | **Not implemented** | Incoming `hop_count > 0` dropped |
| Docker / live Postgres / Redis | Configured | Docker not installed; Redis not running |

## BLE encryption — tested vs untested

**Tested in this environment**

- Protocol unit tests (43 passed): `crypto_box` round-trip, tamper rejection, wrong-key rejection, inner/outer `message_id` bind, empty plaintext refusal, ack retry success + max-attempts timeout, BLE codec handshake v2, BluetoothTransport refuses `alg: none`, TransportManager internet/BLE/neither/both + fallback
- Mobile `tsc --noEmit` (passed)

**Not tested in this environment**

- Any physical iPhone ↔ Android BLE session
- Handshake `pk` over real GATT
- Encrypted send, decrypt, ack notify, timeout, or retry on hardware
- Duplicate protection on hardware
- Internet-off BLE path on hardware
- Expo Go / simulators / web (invalid for this feature)

Chat send goes `MessageService → TransportManager` (internet if the API is up, else BLE if that recipient is nearby, else the local queue). There is no transport picker. Physical BLE remains unverified here.
