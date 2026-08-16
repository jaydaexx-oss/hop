/**
 * GattServer — web / Expo Go stub.
 * Real implementation: GattServer.native.ts
 */
import type { EncryptedEnvelope } from '../transportManager';

export type GattServerStatus = 'stopped' | 'starting' | 'running' | 'error' | 'unsupported';

export async function startGattServer(_profileId: string): Promise<void> {
  /* noop on web */
}

export async function stopGattServer(): Promise<void> {
  /* noop on web */
}

export function subscribeToIncomingMessages(
  _callback: (envelope: EncryptedEnvelope) => void,
): () => void {
  return () => {};
}
