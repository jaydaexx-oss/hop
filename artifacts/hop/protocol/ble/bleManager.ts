/**
 * Shared BleManager singleton.
 *
 * react-native-ble-plx requires exactly one BleManager per process.
 * Both the discovery hook and the auth hook need access to it, so we
 * instantiate it once here and export a getter.
 *
 * DO NOT import this from web code — it will throw.  All callers must
 * be inside a .native.ts file or guarded by Platform.OS !== 'web'.
 */
import { BleManager } from 'react-native-ble-plx';

let _manager: BleManager | null = null;

export function getBleManager(): BleManager {
  if (!_manager) _manager = new BleManager();
  return _manager;
}
