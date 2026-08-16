/**
 * BLE permissions — web stub.
 * Returns immediately with a "not supported" status.
 * The real implementation is in permissions.native.ts.
 */
export type BlePermissionStatus = 'granted' | 'denied' | 'unavailable' | 'unsupported';

export async function requestBlePermissions(): Promise<BlePermissionStatus> {
  return 'unsupported';
}
