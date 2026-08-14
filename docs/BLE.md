# HOP Bluetooth Low Energy

BLE is a **transport**, not the messaging system. `MessageService` must not import BLE.

**Status: not implemented.** Simulator success is not completion.

## First milestone (only)

```text
Physical iPhone A  →  BLE discovery  →  Physical Android B  →  encrypted payload
```

- No mesh  
- No multi-hop  
- No plaintext  
- One physical iPhone and one physical Android, minimum  

Until this passes, `BluetoothTransport` stays a stub and `RelayTransport` stays a stub.

## Role in the stack

```text
MessageService → TransportManager → BluetoothTransport
                                      ├── scan / advertise (native)
                                      ├── GATT connect
                                      ├── chunk ciphertext
                                      └── notify acks
```

`BluetoothTransport.isAvailable()` is true only when a suitable peer is actually reachable — not when Bluetooth is merely “on”.

## GATT sketch (direct only)

Custom 128-bit HOP service UUID (not a vendor UUID we do not own).

| Characteristic | Use |
|---|---|
| Handshake | Identity public-key fingerprint + ephemeral session material — never a MAC |
| Inbox | Write ciphertext **chunks** |
| Acks | Notify delivery of `message_id` |

Flow:

1. Encrypt the envelope (libsodium / later Signal)  
2. Negotiate MTU  
3. Chunk  
4. Write  
5. Reassemble **before** decrypt  
6. `TransportManager.acceptInbound` — drop duplicates / expired  

Nearby UI shows a **display name** and `Available` or `Relay enabled`. It never shows MAC, GPS, or raw hardware ids.

## Battery

- Adaptive scan: low power in background / app idle; more frequent only while Nearby is open  
- Timeouts and capped retries  
- Never continuous maximum-frequency scanning  
- Android default: `SCAN_MODE_LOW_POWER`; balanced only on the Nearby screen  
- iOS: `allowDuplicates` off unless we have a measured reason  

## Platform limitations (do not fake)

### iOS

- Background **advertising** and **scanning** are tightly restricted. The system may alter advertisement payload in background.  
- Reliable discovery often needs the **foreground**.  
- No Bluetooth MAC access (desirable).  
- Requires `NSBluetoothAlwaysUsageDescription` and a **dev client**; Expo Go is insufficient.  
- `bluetooth-central` / `bluetooth-peripheral` background modes are App Review sensitive and still will not equal Android background behavior.  
- Peripheral + central dual role while suspended is not a reliable mesh radio.

**Fallback:** foreground Nearby + local queue. Status text must be honest (`Nearby` vs `Offline`).

### Android

- API 31+: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE`.  
- Older APIs: location permission historically required to scan. Prefer `neverForLocation` when we are not using BLE for location.  
- Doze, app standby, and OEM battery savers will stop background scan/advertise.  
- Android 14+ foreground services need the correct **connected-device** (or equivalent) type to even attempt background BLE.  
- Some chipsets mishandle simultaneous GATT server + client.

**Fallback:** same as iOS — do not claim background relay on devices that kill the process.

### Cross-platform technical problems

| Issue | Why it matters |
|---|---|
| Dual role | HOP Nearby wants both phones to find each other; implement **one advertiser + one scanner** first |
| MTU | Payloads will exceed 20–512 bytes; chunking is mandatory |
| iOS vs Android GATT | Bonding, caching, and 16-bit vs 128-bit UUID behavior differ; test the actual pair |
| Role swap | After PoC A→B, test B→A and iPhone↔iPhone, Android↔Android |
| Clock / expiry | Do not require internet time to accept a BLE message |
| Expo | Custom native Swift + Kotlin; not a JS-only BLE library in Expo Go |
| Local Network / Multipeer | Unrelated to BLE but often confused with “nearby”; Multipeer is iOS-only — do not use it as the cross-platform Nearby path |

## Pass criteria (milestone 1)

| Test | Pass |
|---|---|
| Discovery | B appears on Nearby as a display name, not a MAC |
| Encrypted send | A sends; B decrypts and shows the message |
| Plaintext guard | Transport rejects empty/unencrypted envelopes (already unit-tested in protocol) |
| Duplicate | Same `message_id` processed once |
| Internet off | Wi-Fi/cellular off; BLE still delivers |
| Hardware | Real iPhone + real Android; not simulators |

## Out of scope until milestone 1 passes

- `A → B → C → D`  
- Background mesh  
- Relaying without consent  
- Treating iOS simulator Bluetooth as evidence  

## Native module plan (not started)

- iOS: Core Bluetooth (`CBCentralManager`, `CBPeripheralManager`) in a small Swift module  
- Android: Kotlin `BluetoothLeScanner` + `BluetoothGattServer` / `BluetoothGatt`  
- JS: `BluetoothTransport` adapter only  

Do not force BLE into a browser architecture.
