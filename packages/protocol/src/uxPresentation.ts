import { formatUnreadBadge } from "./acks.js";
import { isInFlightOutboundStatus } from "./conversationTransport.js";
import { isOutboxStatus } from "./lifecycle.js";
import type { PeerRelationship } from "./safety.js";

/** Local presentation swatches only. Not identity, not a QR field. */
export const LOCAL_AVATAR_COLORS = [
  "#0EA5E9",
  "#14B8A6",
  "#22C55E",
  "#EAB308",
  "#F97316",
  "#EF4444",
  "#A855F7",
  "#EC4899",
] as const;

export type NearbySheetActionId =
  | "view_profile"
  | "message_request"
  | "connect"
  | "disconnect"
  | "block";

export type RequestCardActionId = "accept" | "decline" | "block";

export type InboxClearMode = "hide";

/**
 * Messages tab badge is unread chats plus inbound requests the user has not
 * accepted. Never invents counts.
 */
export function messagesTabBadgeCount(input: {
  unread: number;
  pendingIncomingRequests: number;
}): number {
  const unread = Number.isFinite(input.unread) ? Math.max(0, Math.floor(input.unread)) : 0;
  const pending = Number.isFinite(input.pendingIncomingRequests)
    ? Math.max(0, Math.floor(input.pendingIncomingRequests))
    : 0;
  return unread + pending;
}

export function messagesTabBadgeLabel(input: {
  unread: number;
  pendingIncomingRequests: number;
}): string | null {
  return formatUnreadBadge(messagesTabBadgeCount(input));
}

export function conversationHasUndeliveredOutbox(
  rows: Array<{ senderId: string; status: string }>,
  selfId: string,
): boolean {
  if (!selfId) return false;
  return rows.some(
    (row) =>
      row.senderId === selfId && (isOutboxStatus(row.status) || isInFlightOutboundStatus(row.status)),
  );
}

/**
 * Local inbox clear is hide-from-list with undo. SQLite and the durable outbox
 * are never deleted here — undelivered rows must keep retrying.
 */
export function inboxThreadClearPolicy(input: { hasUndeliveredOutbox: boolean }): {
  mode: InboxClearMode;
  restoreable: boolean;
  deletesSqlite: false;
  preservesOutbox: true;
} {
  void input.hasUndeliveredOutbox;
  return { mode: "hide", restoreable: true, deletesSqlite: false, preservesOutbox: true };
}

export function nearbyPeerSheetActions(input: {
  canMessage: boolean;
  connected: boolean;
  userId?: string | null;
}): NearbySheetActionId[] {
  const actions: NearbySheetActionId[] = ["view_profile"];
  if (input.connected) actions.push("disconnect");
  else actions.push("connect");
  if (input.canMessage && input.userId) actions.push("message_request");
  if (input.userId) actions.push("block");
  return actions;
}

/** Message request opens the existing request/thread flow. It never sends. */
export function nearbySheetSendsMessage(_action: NearbySheetActionId): false {
  return false;
}

export function nearbySheetUsesSafetyService(action: NearbySheetActionId): boolean {
  return action === "block";
}

export function nearbySheetOpensPeerThread(action: NearbySheetActionId): boolean {
  return action === "message_request";
}

export function requestCardActions(relationship: PeerRelationship): RequestCardActionId[] {
  if (relationship === "incoming_request") return ["accept", "decline", "block"];
  if (relationship === "outgoing_request") return ["block"];
  return [];
}

export function requestCardActionUsesSafetyService(action: RequestCardActionId): true {
  void action;
  return true;
}

export function requestCardCopy(input: {
  relationship: PeerRelationship;
  displayName: string;
  introPreview?: string | null;
}): { title: string; subtitle: string; preview: string; incoming: boolean } {
  const title = input.displayName.trim() || "HOP user";
  const preview = input.introPreview?.trim() || "";
  if (input.relationship === "incoming_request") {
    return {
      title,
      subtitle: "Wants to message you",
      preview: preview || "One introduction. Accept to chat.",
      incoming: true,
    };
  }
  if (input.relationship === "outgoing_request") {
    return {
      title,
      subtitle: "Waiting for them to accept",
      preview: preview || "You already sent an introduction.",
      incoming: false,
    };
  }
  return { title, subtitle: "Request", preview: preview || "Message request", incoming: false };
}

/** Real scan-state labels. Never a hardcoded "Active". */
export function bluetoothStatusLabel(scanState: string): string {
  switch (scanState) {
    case "invisible":
      return "Invisible — not advertising";
    case "bluetooth_off":
      return "Bluetooth off";
    case "permission_needed":
      return "Bluetooth permission needed";
    case "searching":
      return "Looking around";
    case "nobody_nearby":
      return "Bluetooth on · nobody nearby";
    case "peers_found":
      return "Bluetooth on · people nearby";
    case "connection_failure":
      return "Couldn’t connect";
    default:
      return "Bluetooth status unknown";
  }
}

export function isHardcodedActiveBluetoothLabel(label: string): boolean {
  return label.trim().toLowerCase() === "active";
}

/** RSSI percent is never invented. Use proximity bands and real bars only. */
export function rssiPercentForDisplay(_rssi: number | null | undefined): null {
  return null;
}
