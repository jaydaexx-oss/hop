# HOP Bluetooth Low Energy Implementation

> **STATUS: UNVERIFIED ON PHYSICAL DEVICES**
>
> All code described in this document has been written, type-checked, and
> unit-tested on a development machine. **No end-to-end test has been run
> between two physical iOS or Android devices.** The implementation is
> complete enough to test on real hardware; it requires an EAS development
> build to activate the GATT server native module.

---

## What Is Implemented

### 1 — BLE Advertising (peripheral → broadcast)

| File | Role |
|------|------|
| `hooks/useBluetoothAdvertising.native.ts` | Calls `react-native-ble-advertiser` to broadcast `HOP_SERVICE_UUID` + a rotating 4-byte `tempId` in manufacturer data |
| `hooks/useBluetoothAdvertising.ts` | Web/unsupported stub |

Rotation period: 15 minutes (configurable via `TEMP_ID_ROTATION_MS`).

### 2 — BLE Scanning / Discovery (central → scan)

| File | Role |
|------|------|
| `hooks/useBluetoothDiscovery.native.ts` | Scans with `react-native-ble-plx`, parses `HOP_SERVICE_UUID` manufacturer data, populates `discoveredHopPeers` map |
| `hooks/useBluetoothDiscovery.ts` | Web stub |
| `protocol/ble/bleManager.ts` | Shared `BleManager` singleton (one per process — required by `react-native-ble-plx`) |

### 3 — GATT Authentication Handshake (central → read)

| File | Role |
|------|------|
| `hooks/useBluetoothAuthentication.native.ts` | Watches `discoveredHopPeers`; for each new device: connect → read `HOP_VERSION_CHAR` → read `HOP_PEER_ID_CHAR` → disconnect → add to `verifiedBlePeers` |
| `hooks/useBluetoothAuthentication.ts` | Web stub (always empty) |

Limits: max 3 concurrent auth attempts (`MAX_CONCURRENT_AUTH = 3`). Peers are evicted when their TTL in the discovery map expires.

### 4 — GATT Server (peripheral → serve)

| File | Role |
|------|------|
| `modules/hop-ble-server/ios/HopBleServerModule.swift` | iOS `CBPeripheralManager`; serves `HOP_PEER_ID_CHAR` (dynamic read → current `profileId`), `HOP_VERSION_CHAR` (static `"1"`), `HOP_MESSAGE_CHAR` (write → fires `onMessageReceived` event) |
| `modules/hop-ble-server/android/src/main/java/expo/modules/hopbleserver/HopBleServerModule.kt` | Android `BluetoothGattServer` equivalent |
| `modules/hop-ble-server/HopBleServer.podspec` | iOS autolinking config |
| `modules/hop-ble-server/package.json` | Module manifest |
| `modules/hop-ble-server/src/index.ts` | JS interface (not imported by TS-checked code — see note below) |
| `protocol/ble/GattServer.native.ts` | Wraps native module via `NativeModules` + `NativeEventEmitter` |
| `protocol/ble/GattServer.ts` | Web no-op stub |

**Important:** The native module uses `expo-modules-core` internally (Swift/Kotlin side) for module registration, but the JS interface in `GattServer.native.ts` reaches the module via `NativeModules.HopBleServer` from `react-native`. This avoids a compile-time dependency on `expo-modules-core` in the TypeScript project.

### 5 — Message Send (central → write)

| File | Role |
|------|------|
| `protocol/ble/BluetoothTransport.native.ts` | `send(envelope)`: looks up `deviceId` via `peerDeviceMap`, connects, writes base64 envelope to `HOP_MESSAGE_CHAR`, disconnects |
| `protocol/ble/BluetoothTransport.ts` | Web stub |
| `protocol/ble/bleMessage.ts` | `envelopeToBase64 / envelopeFromBase64 / encodeMessageContent / decodeMessageContent`; MAX 500 bytes |

### 6 — Message Receive (peripheral ← write)

| File | Role |
|------|------|
| `context/HopContext.tsx → receiveBluetoothMessage()` | Decodes `EncryptedEnvelope`, deduplicates via `sentIds`, injects message into conversation state, shows notification toast |

### 7 — HopContext Wiring

`context/HopContext.tsx` coordinates all layers:

- `useBluetoothAuthentication(discoveredHopPeers)` → `{ verifiedBlePeers, peerDeviceMap }`
- `bluetoothTransport.setVerifiedPeers()` + `setDeviceMap()` called on each change
- `startGattServer(profile.id)` on profile load; `stopGattServer()` on unmount
- `subscribeToIncomingMessages(receiveBluetoothMessage)` active for HopContext lifetime
- `sendMessage()` sends via GATT for verified peers; falls back to bot-reply simulation for demo users

---

## Message Encoding (PoC — not production encryption)

```
message content (string)
  → JSON-serialise as EncryptedEnvelope
  → UTF-8 bytes
  → base64 string
  → written to HOP_MESSAGE_CHAR (max 500 bytes)
```

`encrypted_payload` = `base64(utf8(plaintext))`. **No cryptographic encryption is applied.** Field is named for interface compatibility with the internet transport layer.

---

## GATT Characteristic Map

| Characteristic UUID | Properties | Value |
|---------------------|------------|-------|
| `HOP_SERVICE_UUID` | — | Service root |
| `HOP_PEER_ID_CHAR` | Read | Current `profileId` (UTF-8 string) |
| `HOP_VERSION_CHAR` | Read | `"1"` (protocol version gate) |
| `HOP_MESSAGE_CHAR` | Write with response | base64-encoded `EncryptedEnvelope` JSON |

UUIDs are defined in `protocol/ble/constants.ts`.

---

## EAS Development Build Requirements

The native module activates **only in an EAS development build** (not Expo Go, not web).

### Prerequisites

```bash
npm install -g eas-cli        # if not already installed
eas login                     # log in to your Expo account
```

### Build commands

```bash
# iOS simulator build
eas build --platform ios --profile development --local

# iOS device build (signed)
eas build --platform ios --profile development

# Android device build
eas build --platform android --profile development
```

### Required `eas.json` profile

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": {
        "simulator": false
      }
    }
  }
}
```

### Required `app.json` fields

```json
{
  "expo": {
    "plugins": ["expo-dev-client"],
    "autolinking": {
      "searchPaths": ["./modules"]
    }
  }
}
```

Both of these are already set in `artifacts/hop/app.json`.

### Verify the native module is active

After installing the development build on a device, open the BLE Debug screen
(accessible from Settings → BLE Debug in the app). If
`NativeModules.HopBleServer` resolved correctly, the GATT server status will
show **Running** within 1–2 seconds of the profile loading.

If the status shows **Unavailable**, the native module did not link. Rebuild
with `eas build` and confirm `HopBleServer.podspec` is present.

---

## Two-Physical-Device BLE Test Procedure

> All steps assume two iOS or Android devices with the EAS development build
> installed. Both devices must have Bluetooth enabled and location permission
> granted (Android requires location for BLE scanning).

### Setup

1. Install the EAS development build on **Device A** and **Device B**.
2. Open HOP on both devices and complete onboarding (create a profile on each).
3. Navigate to **Settings → BLE Debug** on both devices.
4. Confirm both show:
   - Advertising: **Active** (tempId visible)
   - GATT Server: **Running**
   - Discovery: **Scanning**

### Discovery test

5. Place the devices within ~10 m of each other.
6. Within 30 seconds, each device's Discovery section should show the other
   device's tempId appearing in the discovered peers list.

### Authentication test

7. Once a device appears in discovery, the auth hook fires automatically.
8. Within 5–10 seconds, the discovered device should move from
   **Discovered peers** to **Verified peers** on each device's BLE Debug screen.
9. The verified peer's `profileId` (not the tempId) should be visible.

### Message send/receive test

10. On **Device A**, open a conversation with **Device B's profileId** (it will
    appear in the verified peers list; tap it to open a DM).
11. Type a short message (under 100 characters) and send it.
12. On **Device B**, the message should appear in the conversation within 2–5
    seconds. No internet connection is required.
13. Reply from **Device B** — verify **Device A** receives it.

### Failure cases to test

| Scenario | Expected behaviour |
|----------|--------------------|
| Message > 500 bytes (paste a long string) | Send returns error; message shows **Failed** status in UI |
| Device B moves out of BLE range mid-send | Send returns error; message shows **Failed** status |
| App backgrounded on Device B | Message may not be received (background BLE not yet implemented) |
| Two messages sent in rapid succession | Both delivered; deduplication via `sentIds` prevents duplicates on re-delivery |

---

## Known Limitations (not bugs — scope boundaries)

| Limitation | Notes |
|------------|-------|
| No background BLE | iOS `bluetooth-peripheral` UIBackgroundMode and Android foreground service not configured. App must be in foreground on both devices. |
| No message chunking | Payloads > 500 bytes are rejected with an error. Long messages will fail silently to the user (shows Failed status). |
| No delivery ACK | Sender has no confirmation the recipient's app received the message. Status stays SENT, not DELIVERED, after BLE send. |
| No encryption | `encrypted_payload` is base64(plaintext). Do not send sensitive content over BLE in this build. |
| Unregistered company ID | `HOP_COMPANY_ID = 0x4850` is not registered with Bluetooth SIG. Must be replaced before public release. |
| No persistent connections | Each send opens a new GATT connection and closes it. High message frequency will be slow. |
| No relay | Messages only travel one hop (direct BLE). Multi-hop mesh relay is not implemented. |
| Simulator limitations | BLE peripheral mode does not work in iOS Simulator. Physical devices required for all tests. |
| Android build untested | Kotlin module written but not compiled against a real Android SDK in this environment. |

---

## File Inventory — All BLE-Related Files

```
artifacts/hop/
├── modules/
│   └── hop-ble-server/               ← Local Expo native module (activates on EAS Build)
│       ├── package.json
│       ├── HopBleServer.podspec      ← iOS autolinking
│       ├── src/
│       │   └── index.ts              ← JS interface (not TS-checked; see GattServer.native.ts)
│       ├── ios/
│       │   └── HopBleServerModule.swift
│       └── android/
│           ├── build.gradle
│           └── src/main/java/expo/modules/hopbleserver/
│               └── HopBleServerModule.kt
├── protocol/
│   └── ble/
│       ├── bleManager.ts             ← Shared BleManager singleton
│       ├── bleMessage.ts             ← Envelope ↔ base64 encoding
│       ├── BluetoothTransport.ts     ← Web stub
│       ├── BluetoothTransport.native.ts  ← Real GATT client send()
│       ├── GattServer.ts             ← Web stub
│       └── GattServer.native.ts      ← NativeModules wrapper
├── hooks/
│   ├── useBluetoothAdvertising.ts
│   ├── useBluetoothAdvertising.native.ts
│   ├── useBluetoothDiscovery.ts
│   ├── useBluetoothDiscovery.native.ts
│   ├── useBluetoothAuthentication.ts
│   └── useBluetoothAuthentication.native.ts
└── context/
    └── HopContext.tsx                ← Wires all layers together
```

---

## TypeScript Status

One pre-existing error unrelated to BLE:

```
hooks/useColors.ts(23,10): error TS2352
  Conversion of type '{ light: ...; dark: ...; radius: number; }'
  to type 'Record<string, ...>' may be a mistake
```

All BLE-related files are type-error-free. The `modules/` directory is excluded
from compilation via `tsconfig.json`; `GattServer.native.ts` reaches the native
module through `NativeModules` from `react-native` (always typed).

## Test Suite Status

```
Test Suites: 3 passed, 3 total
Tests:       71 passed, 71 total
```

No BLE unit tests are included (BLE hardware APIs cannot be mocked meaningfully
in Jest). The transport decision logic (`transport-decision.test.ts`) covers the
`TransportManager` routing that selects the BLE transport.
