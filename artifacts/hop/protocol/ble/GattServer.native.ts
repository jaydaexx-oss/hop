/**
 * GattServer.native.ts
 *
 * Wraps the HopBleServer native module (modules/hop-ble-server/) to provide a
 * clean interface for starting/stopping the GATT peripheral server and
 * subscribing to incoming BLE messages.
 *
 * Uses react-native's NativeModules + NativeEventEmitter directly rather than
 * importing from expo-modules-core, which avoids a compile-time dependency on
 * the expo-modules-core package while still working correctly at runtime
 * (Expo native modules are registered on the RN native modules bridge).
 *
 * How it's called:
 *   HopContext calls startGattServer(profile.id) once the profile loads, then
 *   calls subscribeToIncomingMessages to wire received messages into state.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { envelopeFromBase64 } from './bleMessage';
import type { EncryptedEnvelope } from '../transportManager';

// ─── Native module reference ──────────────────────────────────────────────────

const HopBleServerNative = (NativeModules.HopBleServer ?? null) as {
  startServer: (profileId: string) => Promise<void>;
  stopServer: () => Promise<void>;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
} | null;

const emitter = HopBleServerNative
  ? new NativeEventEmitter(HopBleServerNative)
  : null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the GATT peripheral server.
 * The server serves HOP_PEER_ID_CHAR, HOP_VERSION_CHAR, HOP_MESSAGE_CHAR.
 * No-op on platforms where the native module is unavailable.
 */
export async function startGattServer(profileId: string): Promise<void> {
  if (!HopBleServerNative) {
    if (__DEV__)
      console.warn('[HopBleServer] Not available — development build required');
    return;
  }
  return HopBleServerNative.startServer(profileId);
}

/**
 * Stop the GATT peripheral server and release BLE resources.
 */
export async function stopGattServer(): Promise<void> {
  if (!HopBleServerNative) return;
  return HopBleServerNative.stopServer();
}

/**
 * Subscribe to incoming EncryptedEnvelope messages written to HOP_MESSAGE_CHAR
 * by remote centrals (other HOP devices).
 *
 * Malformed payloads are silently dropped.
 *
 * @returns Unsubscribe function — call this in cleanup / useEffect return.
 */
export function subscribeToIncomingMessages(
  callback: (envelope: EncryptedEnvelope) => void,
): () => void {
  if (!emitter) return () => {};

  const sub = emitter.addListener(
    'onMessageReceived',
    ({ payload }: { payload: string }) => {
      const envelope = envelopeFromBase64(payload);
      if (!envelope) {
        console.warn('[HopBleServer] Received malformed payload — dropped');
        return;
      }
      callback(envelope);
    },
  );

  return () => sub.remove();
}
