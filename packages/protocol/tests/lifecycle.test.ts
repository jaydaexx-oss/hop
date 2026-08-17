import { describe, expect, it } from "vitest";
import { MessageStatus } from "../src/message.js";
import {
  AckLayer,
  CanonicalLifecycle,
  MAX_OUTBOX_MESSAGES,
  ackLayerFromStatus,
  canonicalLifecycle,
  compareConversationMessages,
  sortConversationMessages,
} from "../src/lifecycle.js";

describe("canonical message lifecycle mapping", () => {
  it("maps persisted statuses onto queued → encrypting → ready → sending → sent → delivered → read", () => {
    expect(canonicalLifecycle(MessageStatus.CREATED)).toBe(CanonicalLifecycle.queued);
    expect(canonicalLifecycle(MessageStatus.ENCRYPTING)).toBe(CanonicalLifecycle.encrypting);
    expect(canonicalLifecycle(MessageStatus.ENCRYPTED)).toBe(CanonicalLifecycle.encrypting);
    expect(canonicalLifecycle(MessageStatus.QUEUED, 0)).toBe(CanonicalLifecycle.ready);
    expect(canonicalLifecycle(MessageStatus.QUEUED, 2)).toBe(CanonicalLifecycle.retrying);
    expect(canonicalLifecycle(MessageStatus.RETRYING)).toBe(CanonicalLifecycle.retrying);
    expect(canonicalLifecycle(MessageStatus.SENDING)).toBe(CanonicalLifecycle.sending);
    expect(canonicalLifecycle(MessageStatus.SENT)).toBe(CanonicalLifecycle.sent);
    expect(canonicalLifecycle(MessageStatus.DELIVERED)).toBe(CanonicalLifecycle.delivered);
    expect(canonicalLifecycle(MessageStatus.READ)).toBe(CanonicalLifecycle.read);
    expect(canonicalLifecycle(MessageStatus.FAILED)).toBe(CanonicalLifecycle.failed);
  });

  it("does not treat transport accepted as delivered", () => {
    expect(ackLayerFromStatus(MessageStatus.SENT)).toBe(AckLayer.transport_accepted);
    expect(ackLayerFromStatus(MessageStatus.DELIVERED)).toBe(AckLayer.delivered);
    expect(ackLayerFromStatus(MessageStatus.READ)).toBe(AckLayer.read);
    expect(ackLayerFromStatus(MessageStatus.QUEUED)).toBeNull();
  });

  it("orders same-sender streams by send_seq despite clock skew", () => {
    const laterClock = {
      message_id: "b",
      sender_id: "alice",
      created_at: "2026-01-01T00:00:00.000Z",
      send_seq: 1,
    };
    const earlierClock = {
      message_id: "a",
      sender_id: "alice",
      created_at: "2026-12-01T00:00:00.000Z",
      send_seq: 2,
    };
    expect(compareConversationMessages(laterClock, earlierClock)).toBeLessThan(0);
    expect(sortConversationMessages([earlierClock, laterClock]).map((row) => row.message_id)).toEqual([
      "b",
      "a",
    ]);
  });

  it("merges two senders without cycles when clocks jump", () => {
    const alice1 = { message_id: "a1", sender_id: "alice", created_at: "2026-01-01T00:00:02.000Z", send_seq: 1 };
    const alice2 = { message_id: "a2", sender_id: "alice", created_at: "2026-01-01T00:00:00.000Z", send_seq: 2 };
    const bob1 = { message_id: "b1", sender_id: "bob", created_at: "2026-01-01T00:00:01.000Z", send_seq: 1 };
    expect(sortConversationMessages([alice2, bob1, alice1]).map((row) => row.message_id)).toEqual([
      "b1",
      "a1",
      "a2",
    ]);
    expect(sortConversationMessages([bob1, alice1, alice2]).map((row) => row.message_id)).toEqual([
      "b1",
      "a1",
      "a2",
    ]);
  });

  it("breaks same-timestamp ties by sender_id then message_id", () => {
    const t = "2026-08-16T00:00:00.000Z";
    const a = { message_id: "m-b", sender_id: "bob", created_at: t, send_seq: 1 };
    const b = { message_id: "m-a", sender_id: "alice", created_at: t, send_seq: 1 };
    expect(sortConversationMessages([a, b]).map((row) => row.message_id)).toEqual(["m-a", "m-b"]);
  });

  it("caps the durable outbox", () => {
    expect(MAX_OUTBOX_MESSAGES).toBeGreaterThanOrEqual(100);
    expect(MAX_OUTBOX_MESSAGES).toBeLessThanOrEqual(1_000);
  });
});
