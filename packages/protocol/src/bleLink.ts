import type { EncryptedEnvelope, SendResult } from "./transport.js";

export type BleScanMode = "lowPower" | "balanced" | "lowLatency";

export interface BlePeer {
  /** Opaque OS identifier. Never show this in UI — it may be a MAC on Android. */
  deviceId: string;
  displayName: string;
  userId?: string;
  publicKey?: string;
  sessionEstablished?: boolean;
  rssi?: number;
  lastSeenAt: number;
}

export interface BleLinkStatus {
  implemented: boolean;
  bluetoothOn: boolean;
  permissionGranted: boolean;
  advertising: boolean;
  scanning: boolean;
  advertisingSupported: boolean;
  detail: string;
}

export interface BleSessionOptions {
  userId: string;
  username: string;
  scanMode: BleScanMode;
  identityPublicKey: string;
  /** Opt-in: forward others' encrypted envelopes. Default off. */
  relayConsent?: boolean;
  /** Resolve a peer's server-published identity key for BLE handshake attestation. */
  resolveServerPublicKey?: (userId: string) => Promise<string | null | undefined>;
}

export interface BleLink {
  status(): BleLinkStatus;
  requestPermission(): Promise<boolean>;
  startSession(options: BleSessionOptions): Promise<void>;
  stopSession(): Promise<void>;
  setScanMode(mode: BleScanMode): Promise<void>;
  listPeers(): BlePeer[];
  connect(deviceId: string, timeoutMs: number): Promise<BlePeer>;
  disconnect(deviceId: string): Promise<void>;
  send(deviceId: string, envelope: EncryptedEnvelope): Promise<SendResult>;
  subscribe(handler: (envelope: EncryptedEnvelope, from: BlePeer) => void | boolean | Promise<void | boolean>): () => void;
  onPeersChanged(handler: () => void): () => void;
  onConnectionChanged(handler: (deviceId: string, connected: boolean) => void): () => void;
}
