# Implementation status

Updated with Step 1 (repository skeleton).

| Item | Status | Tested |
|---|---|---|
| Repository at `~/hop` | Implemented | N/A |
| Message model | Implemented | Unit tests in `packages/protocol` |
| State machine | Implemented | Unit tests (TS + Python) |
| Duplicate ID set | Implemented | Unit tests |
| TTL / hop stop rules | Implemented | Unit tests |
| Retry backoff policy | Implemented | Unit tests |
| TransportManager | Implemented | Unit tests |
| LocalTransport | Partially implemented (memory only) | Unit tests |
| InternetTransport | Not implemented | Stub only |
| BluetoothTransport | Not implemented | Stub only |
| RelayTransport | Not implemented | Stub only |
| FastAPI `/health` | Implemented | Unit tests |
| Auth / users / messages APIs | Not implemented | 501 stubs |
| PostgreSQL models | Implemented as SQLModel classes | Not migrated |
| SQLite | Not implemented | |
| Expo tabs UI | Implemented (source) | App not run (deps may be missing) |
| E2EE | Not implemented | |
| BLE PoC | Not implemented | Plan only |
| Docker stack | Files only | Blocked: Docker not installed |
