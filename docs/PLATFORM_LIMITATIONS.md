# Platform limitations

HOP will not fake BLE behavior that the OS does not allow.

## iOS

- Background advertising and scanning are tightly restricted
- Reliable Nearby/BLE often requires the app in the foreground
- Bluetooth MAC addresses are not available (this is desirable)
- Requires a dev client / native module; Expo Go cannot host HOP BLE
- Info.plist: `NSBluetoothAlwaysUsageDescription`

**Fallback if background advertise is impossible:** foreground Nearby + local queue, with an honest `Nearby` vs `Offline` status.

## Android

- API 31+: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `BLUETOOTH_ADVERTISE`
- Older APIs historically required location permission for scans
- Doze and background scan limits apply
- Default scan mode: `SCAN_MODE_LOW_POWER`. Balanced only while Nearby is open

## Battery

- Adaptive scanning, timeouts, capped retries
- Never continuous maximum-frequency scanning
- Nearby screen open ≠ background scan policy

## This machine (dev environment)

- Docker is not installed, so Compose has not been executed
- Disk space is constrained; Expo `node_modules` may fail to install until space is freed
