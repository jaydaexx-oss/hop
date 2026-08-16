---
name: HOP BLE Messaging Architecture
description: Architecture decisions and caveats for the full BLE advertising + auth + messaging stack in artifacts/hop
---

# HOP BLE Messaging Architecture

## Rule: Do NOT import expo-modules-core directly from TypeScript-checked code
The `expo-modules-core` package is not directly installed in the hop workspace (it's a transitive dep only, not resolvable by pnpm). Any file that is imported by the main TS compilation will fail if it imports from `expo-modules-core`. Use `NativeModules` + `NativeEventEmitter` from `react-native` instead.

**Why:** GattServer.native.ts was originally written to import from `expo-modules-core` and caused TS error TS2307. Rewrote to use `NativeModules` directly. The native module (Expo module) is still registered on the RN bridge at runtime.

**How to apply:** Always use `NativeModules.HopBleServer` + `NativeEventEmitter` in GattServer.native.ts. The local module src/index.ts (which does import expo-modules-core) is excluded from TS compilation via tsconfig.json `exclude: ["modules"]` AND is not imported by any TS-checked file.

## Rule: BleManager singleton must live in bleManager.ts
Both `useBluetoothDiscovery.native.ts` and `useBluetoothAuthentication.native.ts` need the same BleManager instance. react-native-ble-plx requires exactly one per process.

**Why:** Originally each hook had its own getManager() — moving to shared bleManager.ts prevents double-init.

**How to apply:** Always import `getBleManager()` from `@/protocol/ble/bleManager`. Never call `new BleManager()` elsewhere.

## Rule: Discovery ≠ Authentication (strict separation)
`discoveredHopPeers` (from useBluetoothDiscovery) = advertisement seen, tempId extracted, NOT authenticated.
`verifiedBlePeers` (from useBluetoothAuthentication) = GATT connect + HOP_PEER_ID_CHAR read + profileId extracted.

**Why:** Privacy and correctness. A device nearby ≠ a HOP user you know. verifiedBlePeers is always empty until a physical device test completes the GATT handshake.

## Rule: receiveBluetoothMessage must be declared AFTER showStorageError
The callback depends on showStorageError (it's in the dep array). If placed before showStorageError declaration, TS throws TS2448 (used before assigned).

**Why:** HopContext places showStorageError around line 510. receiveBluetoothMessage must come after it.

## GATT Server Status
The native module (modules/hop-ble-server/) is written but activates only on EAS Build (no ios/ or android/ dirs in repo — managed workflow). The module is registered via package.json `"hop-ble-server": "file:./modules/hop-ble-server"` and tsconfig.json excludes the modules/ dir.

## Two-tier BLE peer state (canonical)
1. `discoveredHopPeers: Map<deviceId, DiscoveredHopPeer>` — advertisement parsing only
2. `verifiedBlePeers: Set<profileId>` — post-GATT-handshake
3. `peerDeviceMap: Map<profileId, deviceId>` — reverse lookup for send()

Both (2) and (3) come from `useBluetoothAuthentication`, NOT from discovery.

## Message encoding (PoC, not production)
`encrypted_payload` = base64(utf8(plaintext)). No actual encryption. MAX 500 bytes. Chunking not implemented — messages over 500 bytes return ok:false.

## sendMessage BLE path
If `verifiedBlePeers.has(userId)`: creates EncryptedEnvelope, calls bluetoothTransport.send() fire-and-forget, skips bot reply, sets FAILED status on error. Sim users (USER_POOL) still get bot reply as before.

## Unregistered company ID
HOP_COMPANY_ID = 0x4850 is not registered with Bluetooth SIG. Must be replaced before public release.
