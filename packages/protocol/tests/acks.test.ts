import { describe, expect, it } from "vitest";

import {
  ACK_PROTOCOL_VERSION,
  AckType,
  conversationIsActivelyViewed,
  countUnread,
  formatUnreadBadge,
  mergePersistedStatus,
  parseAckPlain,
} from "../src/acks.js";
import { MessageStatus } from "../src/message.js";
import type { ApplicationPlaintext } from "../src/cryptoBox.js";

function ackPlain(overrides: Partial<ApplicationPlaintext> = {}): ApplicationPlaintext {
  return {
    message_id: "ack-1",
    sender_id: "bob",
    recipient_id: "alice",
    conversation_id: "convo",
    text: "",
    created_at: "2026-08-16T00:00:00.000Z",
    expires_at: "2026-08-23T00:00:00.000Z",
    ttl: 1,
    hop_count: 0,
    kind: "delivery_ack",
    ack_of: "msg-1",
    ack_status: "DELIVERED",
    ack_type: AckType.DELIVERED_ACK,
    ack_v: ACK_PROTOCOL_VERSION,
    ...overrides,
  };
}

describe("encrypted ack protocol helpers", () => {
  it("parses DELIVERED_ACK and READ_ACK with protocol version", () => {
    const delivered = parseAckPlain(ackPlain());
    expect(delivered?.ack_type).toBe(AckType.DELIVERED_ACK);
    expect(delivered?.ack_status).toBe("DELIVERED");
    expect(delivered?.ack_v).toBe(1);
    const read = parseAckPlain(ackPlain({ ack_status: "READ", ack_type: AckType.READ_ACK }));
    expect(read?.ack_type).toBe(AckType.READ_ACK);
  });

  it("rejects content-bearing, mismatched, and unknown-version acks", () => {
    expect(parseAckPlain(ackPlain({ text: "secret body" }))).toBeNull();
    expect(parseAckPlain(ackPlain({ ack_v: 99 }))).toBeNull();
    expect(parseAckPlain(ackPlain({ ack_status: "READ", ack_type: AckType.DELIVERED_ACK }))).toBeNull();
    expect(parseAckPlain(ackPlain({ ack_of: "ack-1", message_id: "ack-1" }))).toBeNull();
    expect(parseAckPlain(ackPlain({ ack_of: "x".repeat(10_000) }))).toBeNull();
  });

  it("never regresses SENT → DELIVERED → READ", () => {
    expect(mergePersistedStatus(MessageStatus.READ, MessageStatus.DELIVERED)).toBe(MessageStatus.READ);
    expect(mergePersistedStatus(MessageStatus.READ, MessageStatus.SENT)).toBe(MessageStatus.READ);
    expect(mergePersistedStatus(MessageStatus.DELIVERED, MessageStatus.SENT)).toBe(MessageStatus.DELIVERED);
    expect(mergePersistedStatus(MessageStatus.FAILED, MessageStatus.READ)).toBe(MessageStatus.READ);
    expect(mergePersistedStatus(MessageStatus.ENCRYPTING, MessageStatus.CREATED)).toBe(MessageStatus.ENCRYPTING);
    expect(mergePersistedStatus(MessageStatus.QUEUED, MessageStatus.ENCRYPTING)).toBe(MessageStatus.QUEUED);
    expect(mergePersistedStatus(MessageStatus.READ, MessageStatus.DELIVERED)).toBe(MessageStatus.READ);
  });

  it("derives unread from inbound DELIVERED rows", () => {
    expect(
      countUnread(
        [
          { sender_id: "bob", status: MessageStatus.DELIVERED, kind: "message" },
          { sender_id: "bob", status: MessageStatus.READ, kind: "message" },
          { sender_id: "alice", status: MessageStatus.DELIVERED, kind: "message" },
          { sender_id: "bob", status: MessageStatus.DELIVERED, kind: "delivery_ack" },
        ],
        "alice",
      ),
    ).toBe(1);
    expect(formatUnreadBadge(0)).toBeNull();
    expect(formatUnreadBadge(3)).toBe("3");
    expect(formatUnreadBadge(120)).toBe("99+");
  });

  it("only treats a focused foreground conversation as actively viewed", () => {
    expect(conversationIsActivelyViewed({ isConversationScreenFocused: true, appState: "active" })).toBe(true);
    expect(conversationIsActivelyViewed({ isConversationScreenFocused: true, appState: "background" })).toBe(false);
    expect(conversationIsActivelyViewed({ isConversationScreenFocused: false, appState: "active" })).toBe(false);
  });
});
