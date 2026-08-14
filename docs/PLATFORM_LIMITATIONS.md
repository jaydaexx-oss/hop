# Platform limitations

HOP will not fake BLE behavior that the OS does not allow.

## iOS

- Background advertising and scanning are tightly restricted. HOP **stops** scan, advertise, and connections when Nearby is left or the app is backgrounded.
- Reliable Nearby/BLE requires the app in the **foreground** with the Nearby tab open.
- Bluetooth MAC addresses are not available to the app (this is desirable). The Nearby UI shows a display name, never a MAC.
- iOS peripheral advertising through public CoreBluetooth only includes **local name + service UUIDs**. Handshake identity and payloads go in GATT characteristics, not the advertisement packet.
- Local name is short and may be truncated (`HOP:<username>` up to 8 username characters).
- ATT MTU is negotiated by the system; apps cannot set it.
- Requires a **development build**; Expo Go cannot host HOP BLE.
- Info.plist: `NSBluetoothAlwaysUsageDescription`, `NSBluetoothPeripheralUsageDescription`.
- Terminated-state BLE relaunch is not a HOP feature. Do not expect messages after a force-quit.

**Fallback if advertising is impossible:** the other phone advertises; this iPhone scans and connects as central. Status stays honest (`Not advertising` vs `Scanning`).

## Android

- API 31+: runtime `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE`.
- Older APIs historically required **location** permission (and Location on) for scans. HOP still declares fine/coarse location for those devices.
- Doze and OEM background limits apply. HOP does not keep a hidden background scanner; Nearby must be open.
- Default HOP scan while Nearby is open: **balanced**, in 12s on / 8s off pulses — not continuous `LOW_LATENCY`.
- Advertisement payload can include extra Android-only fields; HOP does not rely on them so iOS can interop.
- `requestMTU` is Android-only; iOS ignores it.
- A BLE device identifier may be a MAC internally. The UI must not display it.

## Battery

- Adaptive scanning: balanced pulses only while Nearby is focused
- Timeouts: connect 15s, ack 8s per attempt (max 3 attempts, backoff 1s then 2s), peer stale 25s
- Never continuous maximum-frequency scanning
- Nearby screen open ≠ background scan policy

## This machine (dev environment)

- Docker is not installed, so Compose has not been executed
- No Xcode / no attached phones here, so the BLE PoC has **not** been run on hardware
- Disk space can be tight; Expo `node_modules` may fail until space is freed
