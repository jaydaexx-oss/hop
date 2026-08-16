# HOP BLE Implementation

**Status: Discovery PoC — physical-device testing required before claiming BLE works.**

---

## What is implemented

| Feature | Status |
|---|---|
| BLE service UUID + characteristic schema | ✅ Implemented |
| Android BLE permission request (API 31+) | ✅ Implemented |
| Android BLE permission request (API ≤ 30) | ✅ Implemented |
| iOS BLE permission (auto via plist) | ✅ Implemented |
| Scan filter: HOP_SERVICE_UUID only | ✅ Implemented |
| Peer verification (connect → read → disconnect) | ✅ Implemented |
| Protocol version gating | ✅ Implemented |
| Peer TTL expiry | ✅ Implemented |
| Battery-safe scan windowing + re-scan timer | ✅ Implemented |
| Transport badge in chat UI | ✅ Implemented |
| Offline queue banner in chat UI | ✅ Implemented |
| Transport decision unit tests | ✅ Implemented (30 tests) |
| **BLE message send over GATT** | 🚧 Next milestone |
| **BLE peripheral mode (advertising)** | 🚧 Next milestone |
| **Multi-hop relay** | ❌ Not started |

---

## What is simulated (demo only)

The **Radar screen** (`app/(tabs)/index.tsx`) shows animated nearby user nodes.
These are driven by `nearbyUsers` in HopContext — a `setInterval` that picks
random users from `USER_POOL` every 5 seconds.

**This simulation is explicitly separated from transport decisions.**
`useTransportState` uses only `verifiedBlePeers` (real BLE) for the
`bluetooth` transport kind. The Radar simulation does not affect transport.

The chat header will show 🌐 **Internet** (or ⚠️ **No connection**) in Expo Go
and the web preview because `verifiedBlePeers` is always empty there.
Only a development build running on a physical device will show 🔵 **Bluetooth**.

---

## BLE Service Schema

### Service UUID

```
484F5000-484F-5000-8000-000000000001
```

Encoding: `H=0x48, O=0x4F, P=0x50`. Custom 128-bit UUID — not in Bluetooth SIG registry.

### Characteristics

| UUID | Name | Properties | Value |
|---|---|---|---|
| `484F5001-…` | `HOP_PEER_ID_CHAR` | Read | UTF-8 `profile.id` (UUID string, 36 bytes) |
| `484F5002-…` | `HOP_VERSION_CHAR` | Read | `uint8` — `HOP_BLE_PROTOCOL_VERSION` (currently `1`) |
| `484F5003-…` | `HOP_MESSAGE_CHAR` | Write-Without-Response, Notify | **Not yet implemented** |

### Discovery flow

```
Scanner                        Peripheral
   │                               │
   │── startDeviceScan(HOP_SVC) ──▶│ (advertising HOP_SERVICE_UUID)
   │◀── device found ──────────────│
   │                               │
   │── connectToDevice() ─────────▶│
   │── discoverAllServices() ──────▶│
   │                               │
   │── readChar(HOP_VERSION_CHAR) ─▶│
   │◀── uint8(1) ──────────────────│
   │   [version mismatch → disconnect + skip]
   │                               │
   │── readChar(HOP_PEER_ID_CHAR) ─▶│
   │◀── UTF-8 profile.id ──────────│
   │   [invalid ID → disconnect + skip]
   │                               │
   │── cancelConnection() ─────────▶│
   │                               │
   [add profileId to verifiedBlePeers]
```

---

## iOS Limitations

1. **Development build required.** BLE does not work in Expo Go (managed sandbox).
   Use `npx expo run:ios` or `eas build --platform ios --profile development`.

2. **NSBluetoothAlwaysUsageDescription** must be set in `app.json` under
   `expo.ios.infoPlist`. Already added. The system shows the permission dialog
   automatically on first BLE API access — no runtime call needed.

3. **Background scanning.** iOS suspends BLE scanning when the app backgrounds.
   To scan in background: add `bluetooth-central` to `UIBackgroundModes` in the
   plist. Not configured yet — foreground-only for PoC.

4. **MAC address randomisation.** iOS randomises device MAC addresses.
   Always use the CBPeripheral UUID (`device.id` in react-native-ble-plx) as the
   device key, never the raw MAC. Already handled in `useBluetoothDiscovery.native.ts`.

5. **Peripheral mode (advertising).** A device can be both central (scanner) and
   peripheral (advertiser) simultaneously on iOS. Peripheral mode requires a
   separate `CBPeripheralManager` — not yet implemented.

6. **Simulator.** The iOS Simulator has no Bluetooth hardware. Physical device required.

---

## Android Limitations

1. **Development build required.** Same as iOS — Expo Go does not include BLE.

2. **Permissions vary by API level.**

   | API level | Required permissions |
   |---|---|
   | 31+ (Android 12+) | `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE` |
   | ≤ 30 (Android 11) | `ACCESS_FINE_LOCATION` (runtime), `BLUETOOTH`, `BLUETOOTH_ADMIN` (manifest) |

   `permissions.native.ts` handles both cases. `app.json` declares all of them.

3. **Background scanning — Android 8+ (Oreo) throttles** unfiltered scans to
   once per 30 minutes for background apps. HOP uses a filtered scan
   (`[HOP_SERVICE_UUID]`) which is less aggressively throttled but still limited.
   Full background operation requires a Foreground Service with a persistent
   notification — not yet implemented.

4. **Emulator.** Android emulator has no BLE hardware (unless virtual BLE is
   configured). Physical device required.

5. **Location permission on API ≤ 30.** Android treats BLE scan results as
   location data, requiring `ACCESS_FINE_LOCATION`. This is a platform quirk,
   not a HOP design choice. The permission dialog copy in `permissions.native.ts`
   explains why to the user.

---

## Required app.json configuration

Already added to `app.json`:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSBluetoothAlwaysUsageDescription":
          "HOP uses Bluetooth to discover and message nearby HOP users without internet."
      }
    },
    "android": {
      "permissions": [
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.BLUETOOTH_ADVERTISE",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.BLUETOOTH",
        "android.permission.BLUETOOTH_ADMIN"
      ]
    }
  }
}
```

---

## Physical device testing procedure

### Prerequisites

1. Two physical devices (iOS or Android — mixing is fine).
2. A development build installed on both:

   ```bash
   # iOS
   npx expo run:ios --device
   # Android
   npx expo run:android --device
   ```

   Or via EAS:
   ```bash
   eas build --platform ios --profile development
   eas build --platform android --profile development
   ```

3. Bluetooth enabled on both devices.

### Step-by-step

**Device A (peripheral — not yet implemented):**
> Peripheral advertising mode is the next milestone. For the PoC, Device A
> must be running a BLE peripheral that advertises `HOP_SERVICE_UUID` and
> responds to characteristic reads. This can be tested with a separate BLE
> peripheral tool (e.g. nRF Connect app in server mode, configured with the
> HOP service UUID and characteristics).

**Device B (central — scanner):**
1. Open HOP → complete onboarding.
2. Open any DM chat.
3. Observe the transport badge in the chat header.
4. Expected initial state: 🌐 **Internet** (or ⚠️ **No connection** if offline).

**With a real HOP peripheral advertising:**
5. Bring Device A (or nRF Connect peripheral) within ~10 metres of Device B.
6. Device B should discover it within the scan window (up to 30 s).
7. Device B connects, reads `HOP_VERSION_CHAR` (must be `0x01`) and
   `HOP_PEER_ID_CHAR` (must be a valid profile.id).
8. If verification passes, Device B adds the profile.id to `verifiedBlePeers`.
9. Open the DM with the profile.id owner — the transport badge should switch
   to 🔵 **Bluetooth** (pulsing).
10. Move Device A out of range. Within `HOP_PEER_TTL_MS` (45 s) the badge
    should revert to 🌐 **Internet**.

### What to log

Enable Metro console in the dev build:
```
[HOP BLE] Device <id> speaks protocol v1, we need v1. ✓
[HOP BLE] Scan error: <message>          ← connection failed (expected for non-HOP devices)
```

Non-HOP devices will cause connection failures (expected) because they do not
have `HOP_SERVICE_UUID`. These errors are silently swallowed.

---

## Known platform limitations summary

| Limitation | iOS | Android |
|---|---|---|
| Expo Go support | ❌ | ❌ |
| Simulator/Emulator | ❌ | ❌ |
| Background scanning | ⚠️ Limited | ⚠️ Throttled (API ≥ 26) |
| MAC address stability | ❌ Randomised | ⚠️ Varies by manufacturer |
| Peripheral mode | ✅ Possible (not yet built) | ✅ Possible (not yet built) |
| Multi-hop relay | ❌ Not built | ❌ Not built |

---

## Next steps

1. **Implement peripheral mode** — HOP devices need to advertise `HOP_SERVICE_UUID`
   so other devices can scan for them. Currently, devices can only scan (central role),
   not be discovered (peripheral role).

2. **Implement `HOP_MESSAGE_CHAR` write** in `BluetoothTransport.native.ts` — the
   actual message delivery over BLE once two peers have verified each other.

3. **Physical device test** of the full discovery flow.

4. **Per-peer transport routing** in `useTransportState` — currently reports
   `bluetooth` for any conversation when ANY BLE peer is verified. Should only
   report `bluetooth` for the specific conversation partner.

5. **Background foreground service** (Android) and background mode entitlement (iOS)
   for scan continuity when the app is backgrounded.

6. **Rotating temp ID** — wrap `HOP_PEER_ID_CHAR` in a short-lived signed token
   so passive observers cannot track devices across rotate periods.
