import { describe, expect, it } from "vitest";
import { MessageStatus, createMessage } from "../src/message.js";
import { IllegalStateTransitionError, canTransition, transition } from "../src/stateMachine.js";

describe("message state machine", () => {
  it("creates messages in CREATED with a UUID v4 id", () => {
    const message = createMessage({
      sender_id: "a",
      recipient_id: "b",
      conversation_id: "c",
    });
    expect(message.status).toBe(MessageStatus.CREATED);
    expect(message.message_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(message.encrypted_payload).toBe("");
    expect(message.hop_count).toBe(0);
  });

  it("allows the happy path to READ", () => {
    let message = createMessage({
      sender_id: "a",
      recipient_id: "b",
      conversation_id: "c",
    });
    const path = [
      MessageStatus.ENCRYPTED,
      MessageStatus.QUEUED,
      MessageStatus.SENDING,
      MessageStatus.SENT,
      MessageStatus.DELIVERED,
      MessageStatus.READ,
    ] as const;
    for (const next of path) {
      message = transition(message, next);
    }
    expect(message.status).toBe(MessageStatus.READ);
  });

  it("allows SENDING to fall back to QUEUED for retry", () => {
    expect(canTransition(MessageStatus.SENDING, MessageStatus.QUEUED)).toBe(true);
  });

  it("rejects illegal transitions", () => {
    const message = createMessage({
      sender_id: "a",
      recipient_id: "b",
      conversation_id: "c",
    });
    expect(() => transition(message, MessageStatus.READ)).toThrow(IllegalStateTransitionError);
  });

  it("cannot leave FAILED or EXPIRED", () => {
    expect(canTransition(MessageStatus.FAILED, MessageStatus.QUEUED)).toBe(false);
    expect(canTransition(MessageStatus.EXPIRED, MessageStatus.CREATED)).toBe(false);
  });
});
