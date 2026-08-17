import { describe, expect, it } from "vitest";

import { MessageStatus } from "../src/message.js";
import {
  mergeChatWindow,
  paginateConversationMessages,
  sortInboxConversations,
} from "../src/conversationUi.js";
import { sortConversationMessages } from "../src/lifecycle.js";

/**
 * Host / unit-test measurements only. These are not device or TestFlight timings.
 * They catch accidental O(n²) in pagination, merge/dedup, and inbox sort.
 */

function row(i: number, conversation = "convo-a") {
  return {
    message_id: `id-${String(i).padStart(5, "0")}`,
    sender_id: i % 2 === 0 ? "alice" : "bob",
    send_seq: Math.floor(i / 2) + 1,
    created_at: `2026-08-16T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`,
    conversation_id: conversation,
    status: MessageStatus.SENT,
  };
}

function measure(fn: () => void): number {
  const started = Date.now();
  fn();
  return Date.now() - started;
}

describe("conversation host/unit-test performance", () => {
  it.each([1_000, 5_000, 10_000])(
    "paginates, merges, and sorts inbox for %s in-memory messages without quadratic blowup",
    (n) => {
      const messages = Array.from({ length: n }, (_, i) => row(i));
      const sortMs = measure(() => {
        sortConversationMessages(messages);
      });
      const pageMs = measure(() => {
        const latest = paginateConversationMessages(messages, { limit: 50 });
        expect(latest.rows).toHaveLength(50);
        paginateConversationMessages(messages, { beforeMessageId: latest.rows[0]?.message_id, limit: 50 });
      });
      const mergeMs = measure(() => {
        const latest = paginateConversationMessages(messages, { limit: 50 }).rows;
        const dup = latest.map((item) => ({ ...item, created_at: "2026-08-17T00:00:00.000Z" }));
        const merged = mergeChatWindow(latest, dup);
        expect(merged).toHaveLength(50);
      });
      const inbox = Array.from({ length: Math.min(n, 500) }, (_, i) => ({
        id: `c-${i}`,
        created_at: "2026-08-01T00:00:00.000Z",
        last: row(i, `c-${i}`),
      }));
      const inboxMs = measure(() => {
        sortInboxConversations(inbox);
      });
      const combined = sortMs + pageMs + mergeMs + inboxMs;
      // Host/unit-test budgets only. Quadratic 10k² work would be orders of magnitude larger.
      expect(combined).toBeLessThan(n === 10_000 ? 3_000 : n === 5_000 ? 1_500 : 750);
      expect(mergeMs).toBeLessThan(250);
    },
  );
});
