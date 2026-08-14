import { describe, expect, it } from "vitest";
import { ProcessedIdSet } from "../src/duplicates.js";
import { MAX_HOPS, createMessage, shouldStopForwarding } from "../src/message.js";

describe("duplicate protection", () => {
  it("accepts the first id and rejects the second", () => {
    const seen = new ProcessedIdSet();
    expect(seen.remember("msg-1")).toBe(true);
    expect(seen.remember("msg-1")).toBe(false);
    expect(seen.has("msg-1")).toBe(true);
  });

  it("evicts oldest ids when over capacity", () => {
    const seen = new ProcessedIdSet(2);
    seen.remember("a");
    seen.remember("b");
    seen.remember("c");
    expect(seen.has("a")).toBe(false);
    expect(seen.has("c")).toBe(true);
  });
});

describe("relay forwarding limits", () => {
  it("stops when hop_count reaches MAX_HOPS", () => {
    const message = {
      ...createMessage({ sender_id: "a", recipient_id: "b", conversation_id: "c" }),
      hop_count: MAX_HOPS,
    };
    expect(shouldStopForwarding(message)).toBe(true);
  });

  it("stops when expired", () => {
    const message = createMessage({
      sender_id: "a",
      recipient_id: "b",
      conversation_id: "c",
      ttl_ms: 1,
      now: new Date("2020-01-01T00:00:00.000Z"),
    });
    expect(shouldStopForwarding(message, new Date("2020-01-02T00:00:00.000Z"))).toBe(true);
  });
});
