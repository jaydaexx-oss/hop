import type { NetworkStatus } from "./transport.js";

export type BleHandshakePhase = "idle" | "announced" | "authenticating" | "authenticated" | "failed";

export type TransportSelectionId = "internet" | "bluetooth" | "local" | "none";

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
  mtu: number | null;
  handshakeState: BleHandshakePhase;
  nativeImplemented: boolean;
  blockedReason: string | null;
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

const UNSAFE_DIAGNOSTICS = /secret|private.?key|ciphertext|crypto_box|audio_b64|plaintext|password|token/i;

export function isSafeDiagnosticsText(value: string): boolean {
  return !UNSAFE_DIAGNOSTICS.test(value);
}
