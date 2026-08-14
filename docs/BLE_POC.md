# BLE proof-of-concept plan

**Not implemented.** Simulator success does not count.

## Milestone 1 (only)

```text
Physical iPhone A → BLE discovery → Physical Android B → encrypted payload
```

No mesh. No multi-hop. No plaintext.

## GATT sketch

- Custom 128-bit HOP service UUID
- Handshake characteristic: identity public-key fingerprint (never a MAC address)
- Inbox characteristic: ciphertext chunks
- Ack characteristic: notify
- Negotiate MTU, chunk, reassemble, then decrypt

Encrypt before any BLE write. `TransportManager` already refuses empty payloads.

## Pass criteria

| Test | Pass |
|---|---|
| Discovery | Peer shown as a display name on Nearby, not a MAC |
| Send | Encrypted payload decrypts on the other phone |
| Duplicate | Same `message_id` processed once |
| Internet off | Still delivers over BLE |

Devices required: one physical iPhone, one physical Android.

## Out of scope until milestone 1 passes

- `A → B → C → D` mesh
- Background mesh routing
- Relaying without consent

See `PLATFORM_LIMITATIONS.md` for iOS/Android constraints.
