/**
 * Shared BleManager singleton.
 *
 * react-native-ble-plx requires exactly one BleManager per process.
 * Both the discovery hook and the auth hook share this instance.
 *
 * Returns null when the native module is unavailable (Expo Go, Jest, or a
 * simulator without the BLE binding) — callers must guard with `if (!manager)`.
 *
 * The conditional require is intentional: a top-level static import would
 * crash the app in Expo Go before the guard runs.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _blePlx: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  _blePlx = require('react-native-ble-plx');
} catch {
  // Native module unavailable — Expo Go, Jest without native build, or a
  // simulator without BLE capability.  getBleManager() will return null.
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _manager: any = null;
let _managerInitFailed = false;

/**
 * Returns the shared BleManager singleton, or null when the native BLE module
 * is unavailable or when BleManager construction fails (the Expo Go scenario:
 * the JS package resolves but the native BleClientManager binding is absent,
 * so `new BleManager()` throws).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBleManager(): any {
  if (!_blePlx || _managerInitFailed) return null;
  if (!_manager) {
    try {
      _manager = new _blePlx.BleManager();
    } catch {
      _managerInitFailed = true;
      return null;
    }
  }
  return _manager;
}

/** The BLE state enum — re-exported so callers don't need to import ble-plx. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BleState: any = _blePlx?.State ?? {};
