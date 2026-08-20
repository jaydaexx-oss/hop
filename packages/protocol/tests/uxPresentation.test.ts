import { describe, expect, it } from "vitest";

import { MessageStatus } from "../src/message.js";
import { decideInbound, decideOutbound } from "../src/safety.js";
import {
  bluetoothStatusLabel,
  conversationHasUndeliveredOutbox,
  inboxThreadClearPolicy,
  isHardcodedActiveBluetoothLabel,
  messagesTabBadgeCount,
  messagesTabBadgeLabel,
  nearbyPeerSheetActions,
  nearbySheetOpensPeerThread,
  nearbySheetSendsMessage,
  nearbySheetUsesSafetyService,
  requestCardActionUsesSafetyService,
  requestCardActions,
  requestCardCopy,
  rssiPercentForDisplay,
} from "../src/uxPresentation.js";
import { decodeHopQrPayload, encodeHopQrPayload, hopQrContainsSecrets, hopQrUri } from "../src/hopQr.js";

describe("radar / nearby sheet presentation policy", () => {
  it("never auto-DMs; message request opens the request flow and block uses SafetyService", () => {
    expect(
      nearbyPeerSheetActions({ canMessage: true, connected: false, userId: "peer-1" }),
    ).toEqual(["view_profile", "connect", "message_request", "block"]);
    expect(
      nearbyPeerSheetActions({ canMessage: false, connected: false, userId: undefined }),
    ).toEqual(["view_profile", "connect"]);
    for (const action of nearbyPeerSheetActions({
      canMessage: true,
      connected: true,
      userId: "peer-1",
    })) {
      expect(nearbySheetSendsMessage(action)).toBe(false);
    }
    expect(nearbySheetOpensPeerThread("message_request")).toBe(true);
    expect(nearbySheetUsesSafetyService("block")).toBe(true);
    expect(nearbySheetUsesSafetyService("message_request")).toBe(false);
  });

  it("does not invent an RSSI percent", () => {
    expect(rssiPercentForDisplay(undefined)).toBeNull();
    expect(rssiPercentForDisplay(null)).toBeNull();
    expect(rssiPercentForDisplay(-42)).toBeNull();
  });
});

describe("message request cards", () => {
  it("exposes accept / decline / block for inbound requests via SafetyService", () => {
    expect(requestCardActions("incoming_request")).toEqual(["accept", "decline", "block"]);
    expect(requestCardActions("outgoing_request")).toEqual(["block"]);
    expect(requestCardActionUsesSafetyService("accept")).toBe(true);
    expect(requestCardActionUsesSafetyService("decline")).toBe(true);
    expect(requestCardActionUsesSafetyService("block")).toBe(true);
    const copy = requestCardCopy({
      relationship: "incoming_request",
      displayName: "blake",
      introPreview: "Hey — around campus",
    });
    expect(copy.incoming).toBe(true);
    expect(copy.preview).toBe("Hey — around campus");
  });

  it("keeps the one-intro-before-accept invariant", () => {
    const first = decideOutbound(null);
    expect(first).toMatchObject({ allow: true, asRequest: true });
    const second = decideOutbound({
      peerId: "p",
      relationship: "outgoing_request",
      muted: false,
      introMessageId: "m1",
      preBlockRelationship: null,
      updatedAt: "2026-08-17T00:00:00.000Z",
    });
    expect(second.allow).toBe(false);
    if (!second.allow) expect(second.code).toBe("intro_limit");
    const inboundSecond = decideInbound({
      peerId: "p",
      relationship: "incoming_request",
      muted: false,
      introMessageId: "m1",
      preBlockRelationship: null,
      updatedAt: "2026-08-17T00:00:00.000Z",
    });
    expect(inboundSecond.allow).toBe(false);
    if (!inboundSecond.allow) expect(inboundSecond.code).toBe("intro_limit");
  });
});

describe("inbox badges, mute-safe clear, and Bluetooth copy", () => {
  it("builds the Messages tab badge from real unread plus pending incoming requests", () => {
    expect(messagesTabBadgeCount({ unread: 0, pendingIncomingRequests: 0 })).toBe(0);
    expect(messagesTabBadgeLabel({ unread: 0, pendingIncomingRequests: 0 })).toBeNull();
    expect(messagesTabBadgeCount({ unread: 2, pendingIncomingRequests: 3 })).toBe(5);
    expect(messagesTabBadgeLabel({ unread: 2, pendingIncomingRequests: 3 })).toBe("5");
    expect(messagesTabBadgeCount({ unread: Number.NaN, pendingIncomingRequests: -1 })).toBe(0);
  });

  it("hides a thread instead of deleting SQLite when outbox rows are undelivered", () => {
    expect(
      conversationHasUndeliveredOutbox(
        [{ senderId: "me", status: MessageStatus.QUEUED }],
        "me",
      ),
    ).toBe(true);
    expect(
      conversationHasUndeliveredOutbox([{ senderId: "me", status: MessageStatus.SENT }], "me"),
    ).toBe(false);
    const policy = inboxThreadClearPolicy({ hasUndeliveredOutbox: true });
    expect(policy.mode).toBe("hide");
    expect(policy.deletesSqlite).toBe(false);
    expect(policy.preservesOutbox).toBe(true);
    expect(policy.restoreable).toBe(true);
    expect(inboxThreadClearPolicy({ hasUndeliveredOutbox: false }).deletesSqlite).toBe(false);
  });

  it("maps Discoverable/scan state to real Bluetooth copy, never hardcoded Active", () => {
    for (const state of [
      "invisible",
      "bluetooth_off",
      "permission_needed",
      "searching",
      "nobody_nearby",
      "peers_found",
      "connection_failure",
      "unknown-future-state",
    ]) {
      const label = bluetoothStatusLabel(state);
      expect(isHardcodedActiveBluetoothLabel(label)).toBe(false);
      expect(label.toLowerCase()).not.toBe("active");
    }
    expect(bluetoothStatusLabel("invisible")).toContain("Invisible");
    expect(bluetoothStatusLabel("bluetooth_off")).toContain("off");
    expect(bluetoothStatusLabel("permission_needed").toLowerCase()).not.toContain("off");
  });
});

describe("QR payload stays username + invite", () => {
  it("does not encode secrets, colors, or device ids as identity", () => {
    const payload = encodeHopQrPayload({ username: "jaydae" });
    expect(Object.keys(payload).sort()).toEqual(["invite", "kind", "username", "v"]);
    const uri = hopQrUri(payload);
    expect(hopQrContainsSecrets(uri)).toBe(false);
    expect(uri).toMatch(/^hop:\/\/u\/jaydae\?i=h/);
    expect(JSON.stringify(payload)).not.toMatch(/color|avatar|mac|deviceId|secret|crypto_box/i);
    expect(decodeHopQrPayload(uri)?.username).toBe("jaydae");
  });
});
