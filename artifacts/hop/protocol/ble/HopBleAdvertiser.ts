/**
 * HopBleAdvertiser — web / unsupported platform stub.
 *
 * BLE peripheral mode is not available on web.  This stub keeps the module
 * importable while always returning 'unsupported'.
 * The real implementation is in HopBleAdvertiser.native.ts.
 */

import type { TempId } from './tempId';

export type AdvertisingStatus =
  | 'advertising'   // actively broadcasting HOP service
  | 'stopped'       // radio is on but not advertising
  | 'unsupported'   // peripheral mode not supported on this platform/device
  | 'unauthorized'  // BLE permission denied
  | 'unavailable'   // BLE radio is off
  | 'error';        // unexpected error

export interface AdvertisingState {
  status: AdvertisingStatus;
  /** The tempId currently being advertised (null when not advertising) */
  currentTempId: TempId | null;
  /** Unix timestamp when the tempId will rotate (0 when not advertising) */
  nextRotationAt: number;
}

export class HopBleAdvertiser {
  async start(_tempId: TempId): Promise<AdvertisingStatus> {
    return 'unsupported';
  }

  async stop(): Promise<void> {
    // no-op
  }

  async isSupported(): Promise<boolean> {
    return false;
  }
}

/** Singleton stub for web. */
export const hopBleAdvertiser = new HopBleAdvertiser();
