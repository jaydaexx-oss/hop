/**
 * useBluetoothAdvertising — web / unsupported platform stub.
 *
 * Returns a static "unsupported" state so callers have a consistent interface
 * regardless of platform.  The real hook is in useBluetoothAdvertising.native.ts.
 */

import type { AdvertisingStatus } from '@/protocol/ble/HopBleAdvertiser';
export type { AdvertisingStatus };

export interface BluetoothAdvertisingState {
  status: AdvertisingStatus;
  /** Hex string of the tempId currently being advertised, null if stopped */
  myTempIdHex: string | null;
  /** When the current tempId will rotate (ms), 0 if not advertising */
  nextRotationAt: number;
  /** Seconds remaining until next tempId rotation */
  secondsUntilRotation: number;
  startAdvertising: () => Promise<void>;
  stopAdvertising: () => Promise<void>;
}

const NOOP = async () => {};

export function useBluetoothAdvertising(): BluetoothAdvertisingState {
  return {
    status: 'unsupported',
    myTempIdHex: null,
    nextRotationAt: 0,
    secondsUntilRotation: 0,
    startAdvertising: NOOP,
    stopAdvertising: NOOP,
  };
}
