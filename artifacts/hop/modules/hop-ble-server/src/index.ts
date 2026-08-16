/**
 * HopBleServer — JS interface for the native GATT server module.
 *
 * This module runs a GATT peripheral server on the device, serving three
 * characteristics on HOP_SERVICE_UUID so that nearby HOP scanners can:
 *   - Read the device's profile.id (HOP_PEER_ID_CHAR)
 *   - Read the protocol version (HOP_VERSION_CHAR)
 *   - Write encrypted message payloads (HOP_MESSAGE_CHAR)
 *
 * Advertising is NOT handled here — that is the responsibility of
 * HopBleAdvertiser (react-native-ble-advertiser).  This module only
 * serves GATT characteristics once a central connects.
 *
 * Platform support:
 *   - iOS 13+ (CBPeripheralManager — requires Bluetooth peripheral capability)
 *   - Android API 21+ (BluetoothGattServer)
 *   - Web / Expo Go: stubs that return immediately without error
 *
 * Build requirement: EAS Build (development build) — not available in Expo Go.
 */

import { NativeModulesProxy, EventEmitter, Subscription } from 'expo-modules-core';

// ─── Native module interface ──────────────────────────────────────────────────

const HopBleServerNative = NativeModulesProxy.HopBleServer as {
  startServer: (profileId: string) => Promise<void>;
  stopServer: () => Promise<void>;
} | null;

const emitter = HopBleServerNative
  ? new EventEmitter(NativeModulesProxy.HopBleServer as Parameters<typeof EventEmitter>[0])
  : null;

// ─── Events ───────────────────────────────────────────────────────────────────

export interface MessageReceivedEvent {
  /** Base64-encoded EncryptedEnvelope JSON */
  payload: string;
}

export interface PeerConnectionEvent {
  /** BLE device identifier of the connecting central */
  deviceId: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the GATT server and begin serving characteristics.
 *
 * The server stays running until `stopServer()` is called or the process exits.
 * Calling this while the server is already running is a no-op.
 *
 * @param profileId The local device's profile.id — served on HOP_PEER_ID_CHAR.
 */
export async function startServer(profileId: string): Promise<void> {
  if (!HopBleServerNative) {
    console.warn('[HopBleServer] Not available on this platform (web/Expo Go)');
    return;
  }
  return HopBleServerNative.startServer(profileId);
}

/**
 * Stop the GATT server and release all BLE resources.
 */
export async function stopServer(): Promise<void> {
  if (!HopBleServerNative) return;
  return HopBleServerNative.stopServer();
}

/**
 * Subscribe to incoming message writes on HOP_MESSAGE_CHAR.
 *
 * @param listener Called each time a central writes a message payload.
 * @returns Unsubscribe function.
 */
export function addMessageListener(
  listener: (event: MessageReceivedEvent) => void,
): Subscription {
  if (!emitter) {
    // Return a no-op subscription on unsupported platforms.
    return { remove: () => {} };
  }
  return emitter.addListener<MessageReceivedEvent>('onMessageReceived', listener);
}

/**
 * Subscribe to peer connection events.
 */
export function addPeerConnectedListener(
  listener: (event: PeerConnectionEvent) => void,
): Subscription {
  if (!emitter) return { remove: () => {} };
  return emitter.addListener<PeerConnectionEvent>('onPeerConnected', listener);
}

/**
 * Subscribe to peer disconnection events.
 */
export function addPeerDisconnectedListener(
  listener: (event: PeerConnectionEvent) => void,
): Subscription {
  if (!emitter) return { remove: () => {} };
  return emitter.addListener<PeerConnectionEvent>('onPeerDisconnected', listener);
}
