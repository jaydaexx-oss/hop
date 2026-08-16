import { MessageStatus } from "./message.js";
import type { NetworkStatus } from "./transport.js";
import { looksLikeHardwareId, safeNearbyDisplayName } from "./bleCodec.js";

export type ConversationRoute = "nearby" | "online" | "queued" | "offline" | "relaying";

export interface NearbyPeerSnapshot {
  userId?: string;
  sessionEstablished?: boolean;
  connected?: boolean;
}

export interface ConversationTransportInput {
  recipientId: string;
  peers: NearbyPeerSnapshot[];
  internetAvailable: boolean;
  conversationQueued: boolean;
  networkQueued?: boolean;
  lastOutboundStatus?: string | null;
  /** Only pass true when an actual relay hop is in progress. Never invent this. */
  relaying?: boolean;
}

export interface ConversationTransportView {
  route: ConversationRoute;
  emoji: string;
  label: string;
  delivered: boolean;
  line: string;
}

const ROUTE_COPY: Record<ConversationRoute, { emoji: string; label: string }> = {
  nearby: { emoji: "🔵", label: "Nearby — Bluetooth" },
  online: { emoji: "🌐", label: "Online — Internet" },
  queued: { emoji: "🟡", label: "Offline — Queued" },
  offline: { emoji: "🟡", label: "Offline" },
  relaying: { emoji: "🟣", label: "Relaying" },
};

export function localDirectConversationId(userA: string, userB: string): string {
  return `ble:${[userA, userB].sort().join(":")}`;
}

export function authenticatedNearbyPeer(
  recipientId: string,
  peers: NearbyPeerSnapshot[],
): NearbyPeerSnapshot | undefined {
  if (!recipientId) return undefined;
  return peers.find(
    (peer) => peer.userId === recipientId && peer.sessionEstablished === true && peer.connected === true,
  );
}

export function conversationTransportStatus(input: ConversationTransportInput): ConversationTransportView {
  const last = input.lastOutboundStatus ?? null;
  const delivered = last === MessageStatus.DELIVERED || last === MessageStatus.READ;
  const relaying = input.relaying === true || last === MessageStatus.RELAYING;

  let route: ConversationRoute;
  if (relaying) {
    route = "relaying";
  } else if (authenticatedNearbyPeer(input.recipientId, input.peers)) {
    route = "nearby";
  } else if (input.internetAvailable) {
    route = "online";
  } else if (input.conversationQueued || input.networkQueued) {
    route = "queued";
  } else {
    route = "offline";
  }

  const copy = ROUTE_COPY[route];
  const line = delivered ? `${copy.emoji} ${copy.label}  ✓ Delivered` : `${copy.emoji} ${copy.label}`;
  return { route, emoji: copy.emoji, label: copy.label, delivered, line };
}

export function internetStatusAvailable(status: NetworkStatus): boolean {
  return status === "Online" || status === "Synchronizing";
}

export function rssiSignalBars(rssi?: number): 0 | 1 | 2 | 3 | 4 {
  if (typeof rssi !== "number") return 0;
  if (rssi >= -55) return 4;
  if (rssi >= -67) return 3;
  if (rssi >= -80) return 2;
  if (rssi >= -90) return 1;
  return 1;
}

export function nearbyPeerLabel(peer: { displayName?: string | null; sessionEstablished?: boolean }): string {
  const safe = safeNearbyDisplayName(peer.displayName);
  if (peer.sessionEstablished && safe !== "HOP user") return safe;
  if (safe !== "HOP user" && !looksLikeHardwareId(safe)) return safe;
  return "HOP user";
}

export function nearbyPeerPresence(peer: {
  userId?: string;
  sessionEstablished?: boolean;
  connected?: boolean;
}): "authenticated" | "connected" | "available" {
  if (peer.connected && peer.sessionEstablished) return "authenticated";
  if (peer.connected) return "connected";
  return "available";
}

const MESSAGE_STATUS_LABEL: Record<string, string> = {
  [MessageStatus.CREATED]: "Queued",
  [MessageStatus.ENCRYPTED]: "Queued",
  [MessageStatus.QUEUED]: "Queued",
  [MessageStatus.SENDING]: "Sending",
  [MessageStatus.SENT]: "Sent",
  [MessageStatus.RELAYING]: "Relaying",
  [MessageStatus.DELIVERED]: "Delivered",
  [MessageStatus.READ]: "Read",
  [MessageStatus.FAILED]: "Failed",
  [MessageStatus.EXPIRED]: "Expired",
};

export function formatMessageStatus(status: string): string {
  return MESSAGE_STATUS_LABEL[status] ?? status;
}

export function isFailedMessageStatus(status: string): boolean {
  return status === MessageStatus.FAILED || status === MessageStatus.EXPIRED;
}
