import type { BleAdapterState, BleAuthorizationStatus } from "./bleLink.js";
import type { NetworkStatus } from "./transport.js";

export type BleHandshakePhase = "idle" | "announced" | "authenticating" | "authenticated" | "failed";

export type TransportSelectionId = "internet" | "bluetooth" | "local" | "none";

export type BleDiagSendResult = "none" | "ok" | "fail";
export type BleDiagAckResult = "none" | "acked" | "timeout" | "fail";
export type BleDiagInboundResult = "none" | "accepted" | "dropped";

export type TransportSelectionInfo = {
  selected: TransportSelectionId;
  reason: string;
};

/**
 * Safe one-phone technical state. Never include keys, plaintext, voice, or crypto_box.
 * Presence of these fields is not two-phone radio proof.
 */
export type BleDiagnosticsSnapshot = {
  permissionGranted: boolean;
  adapterOn: boolean;
  advertising: boolean;
  scanning: boolean;
  gattRegistered: boolean;
  connected: boolean;
  connectedPeerCount: number;
  discoveredPeerCount: number;
  authenticatedPeerCount: number;
  mtu: number | null;
  handshakeState: BleHandshakePhase;
  nativeImplemented: boolean;
  blockedReason: string | null;
  authorization: BleAuthorizationStatus;
  adapterState: BleAdapterState;
  centralManagerInitialized: boolean;
  nativeProbed: boolean;
  lastSendResult: BleDiagSendResult;
  lastAckResult: BleDiagAckResult;
  lastInboundResult: BleDiagInboundResult;
};

export function describeTransportSelection(input: {
  networkStatus: NetworkStatus;
  bleImplemented: boolean;
  bleBlockedReason: string | null;
}): TransportSelectionInfo {
  if (input.networkStatus === "Online" || input.networkStatus === "Synchronizing") {
    return {
      selected: "internet",
      reason: "API /health reachable; internet is preferred over BLE.",
    };
  }
  if (input.networkStatus === "Nearby" || input.networkStatus === "Relaying") {
    return {
      selected: "bluetooth",
      reason: input.bleImplemented
        ? "Internet unavailable; BLE selected if a session exists."
        : (input.bleBlockedReason ?? "Internet unavailable; BLE is not implemented on this runtime."),
    };
  }
  if (input.networkStatus === "Queued") {
    return {
      selected: "local",
      reason: input.bleBlockedReason ?? "No live transport; encrypted queue is local SQLite.",
    };
  }
  return {
    selected: "none",
    reason: input.bleBlockedReason ?? "Offline; no live transport.",
  };
}

/**
 * What TransportManager would pick for a send: internet /health, else authenticated BLE, else queue.
 * Does not prove a two-phone radio session.
 */
export function describeProofRoute(input: {
  internetHealthOk: boolean;
  bleRadioReady: boolean;
  authenticatedPeerMapped: boolean;
  bleBlockedReason?: string | null;
}): TransportSelectionInfo {
  if (input.internetHealthOk) {
    return {
      selected: "internet",
      reason: "API /health reachable; internet is preferred over BLE.",
    };
  }
  if (input.bleRadioReady && input.authenticatedPeerMapped) {
    return {
      selected: "bluetooth",
      reason: "Internet unavailable; authenticated BLE session is mapped for a nearby peer.",
    };
  }
  if (input.bleRadioReady) {
    return {
      selected: "local",
      reason: "Internet unavailable; BLE radio is on but no authenticated session for the recipient.",
    };
  }
  return {
    selected: "local",
    reason: input.bleBlockedReason ?? "Internet unavailable; no live BLE route. Encrypted queue is local SQLite.",
  };
}

const UNSAFE_DIAGNOSTICS = /secret|private.?key|ciphertext|crypto_box|audio_b64|plaintext|password|token/i;

export function isSafeDiagnosticsText(value: string): boolean {
  return !UNSAFE_DIAGNOSTICS.test(value);
}
