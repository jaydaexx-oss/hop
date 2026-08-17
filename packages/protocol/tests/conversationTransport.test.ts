import { describe, expect, it } from "vitest";
import { MessageStatus } from "../src/message.js";
import {
  authenticatedNearbyPeer,
  conversationPreviewLine,
  conversationTransportStatus,
  formatMessageStatus,
  formatNetworkStatus,
  internetStatusAvailable,
  localDirectConversationId,
  nearbyPeerLabel,
  nearbyPeerPresence,
  rssiSignalBars,
} from "../src/conversationTransport.js";

describe("conversationTransportStatus", () => {
  const recipientId = "user-b";

  it("shows Nearby when an authenticated BLE peer for the recipient is connected", () => {
    const view = conversationTransportStatus({
      recipientId,
      peers: [{ userId: recipientId, sessionEstablished: true, connected: true }],
      internetAvailable: true,
      conversationQueued: false,
    });
    expect(view.route).toBe("nearby");
    expect(view.line).toBe("🔵 Nearby — Bluetooth");
  });

  it("does not fake Nearby from a discovered but unauthenticated peer list", () => {
    const view = conversationTransportStatus({
      recipientId,
      peers: [{ userId: recipientId, sessionEstablished: false, connected: false }],
      internetAvailable: false,
      conversationQueued: false,
    });
    expect(view.route).toBe("offline");
    expect(view.line).toBe("🟡 Offline");
  });

  it("does not show Nearby when connected without a secure session", () => {
    const view = conversationTransportStatus({
      recipientId,
      peers: [{ userId: recipientId, sessionEstablished: false, connected: true }],
      internetAvailable: true,
      conversationQueued: false,
    });
    expect(view.route).toBe("online");
    expect(view.line).toBe("🌐 Online — Internet");
  });

  it("shows Online when internet is available and BLE is not authenticated", () => {
    const view = conversationTransportStatus({
      recipientId,
      peers: [],
      internetAvailable: true,
      conversationQueued: true,
    });
    expect(view.route).toBe("online");
  });

  it("shows Offline — Queued when this conversation has queued outbound messages", () => {
    const view = conversationTransportStatus({
      recipientId,
      peers: [],
      internetAvailable: false,
      conversationQueued: true,
    });
    expect(view.route).toBe("queued");
    expect(view.line).toBe("🟡 Offline — Queued");
  });

  it("shows Offline — Queued when the network queue is holding messages", () => {
    const view = conversationTransportStatus({
      recipientId,
      peers: [],
      internetAvailable: false,
      conversationQueued: false,
      networkQueued: true,
    });
    expect(view.route).toBe("queued");
  });

  it("shows Relaying only when actual relay state exists", () => {
    const idle = conversationTransportStatus({
      recipientId,
      peers: [],
      internetAvailable: false,
      conversationQueued: false,
    });
    expect(idle.route).not.toBe("relaying");

    const live = conversationTransportStatus({
      recipientId,
      peers: [],
      internetAvailable: false,
      conversationQueued: false,
      relaying: true,
    });
    expect(live.route).toBe("relaying");
    expect(live.line).toBe("🟣 Relaying");

    const fromMessage = conversationTransportStatus({
      recipientId,
      peers: [],
      internetAvailable: false,
      conversationQueued: false,
      lastOutboundStatus: MessageStatus.RELAYING,
    });
    expect(fromMessage.route).toBe("relaying");
  });

  it("appends Delivered for the last outbound message when delivered or read", () => {
    const delivered = conversationTransportStatus({
      recipientId,
      peers: [],
      internetAvailable: true,
      conversationQueued: false,
      lastOutboundStatus: MessageStatus.DELIVERED,
    });
    expect(delivered.delivered).toBe(true);
    expect(delivered.line).toContain("✓ Delivered");

    const read = conversationTransportStatus({
      recipientId,
      peers: [],
      internetAvailable: true,
      conversationQueued: false,
      lastOutboundStatus: MessageStatus.READ,
    });
    expect(read.delivered).toBe(true);
    expect(read.line).toContain("✓ Delivered");

    const sent = conversationTransportStatus({
      recipientId,
      peers: [],
      internetAvailable: true,
      conversationQueued: false,
      lastOutboundStatus: MessageStatus.SENT,
    });
    expect(sent.delivered).toBe(false);
    expect(sent.line).not.toContain("✓ Delivered");
  });

  it("ignores BLE peers for a different recipient", () => {
    expect(
      authenticatedNearbyPeer(recipientId, [
        { userId: "someone-else", sessionEstablished: true, connected: true },
      ]),
    ).toBeUndefined();
  });
});

describe("conversation transport helpers", () => {
  it("builds a stable local conversation id from sorted user ids", () => {
    expect(localDirectConversationId("b", "a")).toBe("ble:a:b");
    expect(localDirectConversationId("a", "b")).toBe("ble:a:b");
  });

  it("maps message statuses for chat bubbles", () => {
    expect(formatMessageStatus(MessageStatus.QUEUED)).toBe("Queued");
    expect(formatMessageStatus(MessageStatus.SENDING)).toBe("Sending");
    expect(formatMessageStatus(MessageStatus.SENT)).toBe("Sent");
    expect(formatMessageStatus(MessageStatus.DELIVERED)).toBe("Delivered");
    expect(formatMessageStatus(MessageStatus.READ)).toBe("Read");
    expect(formatMessageStatus(MessageStatus.FAILED)).toBe("Failed");
    expect(formatMessageStatus(MessageStatus.QUEUED, 2)).toBe("Retrying");
    expect(formatMessageStatus(MessageStatus.SENDING, 1)).toBe("Retrying");
  });

  it("treats Online and Synchronizing as internet-available", () => {
    expect(internetStatusAvailable("Online")).toBe(true);
    expect(internetStatusAvailable("Synchronizing")).toBe(true);
    expect(internetStatusAvailable("Nearby")).toBe(false);
    expect(internetStatusAvailable("Queued")).toBe(false);
    expect(internetStatusAvailable("Offline")).toBe(false);
  });

  it("converts RSSI to relative bars without exposing hardware ids", () => {
    expect(rssiSignalBars(undefined)).toBe(0);
    expect(rssiSignalBars(-40)).toBe(4);
    expect(rssiSignalBars(-60)).toBe(3);
    expect(rssiSignalBars(-72)).toBe(2);
    expect(rssiSignalBars(-88)).toBe(1);
  });

  it("never uses a hardware identifier as a Nearby display name", () => {
    expect(nearbyPeerLabel({ displayName: "AA:BB:CC:DD:EE:FF" })).toBe("HOP user");
    expect(nearbyPeerLabel({ displayName: "alex", sessionEstablished: true })).toBe("alex");
    expect(nearbyPeerPresence({ connected: true, sessionEstablished: true })).toBe("authenticated");
    expect(nearbyPeerPresence({ connected: true })).toBe("connected");
    expect(nearbyPeerPresence({})).toBe("available");
  });

  it("maps synchronizing to Reconnecting without inventing a transport", () => {
    expect(formatNetworkStatus("Synchronizing")).toBe("Reconnecting");
    expect(formatNetworkStatus("Offline")).toBe("Offline");
    expect(formatNetworkStatus("Queued")).toBe("Queued");
  });

  it("previews last caption without leaking ciphertext when text is null", () => {
    expect(conversationPreviewLine(null)).toBe("No messages yet");
    expect(
      conversationPreviewLine({
        text: "hello there",
        kind: "message",
        encrypted_payload: "CIPHERTEXT_MUST_NOT_SHOW",
      }),
    ).toBe("hello there");
    expect(
      conversationPreviewLine({
        text: null,
        kind: "message",
        encrypted_payload: "CIPHERTEXT_MUST_NOT_SHOW",
      }),
    ).toBe("Encrypted message");
    expect(
      conversationPreviewLine({
        text: null,
        kind: "voice",
        encrypted_payload: "CIPHERTEXT_MUST_NOT_SHOW",
      }),
    ).toBe("Voice message");
    expect(
      conversationPreviewLine({
        text: "Voice message",
        kind: "voice",
        encrypted_payload: "CIPHERTEXT_MUST_NOT_SHOW",
      }),
    ).toBe("Voice message");
    expect(
      conversationPreviewLine({
        text: null,
        encrypted_payload: "CIPHERTEXT_MUST_NOT_SHOW",
      }).includes("CIPHERTEXT"),
    ).toBe(false);
  });
});
