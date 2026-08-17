import { describe, expect, it } from "vitest";
import { mergePersistedStatus } from "../src/acks.js";
import { MAX_APPLICATION_TEXT_CHARS } from "../src/cryptoBox.js";
import { MessageStatus } from "../src/message.js";
import {
  CHAT_PAGE_SIZE,
  clampComposerText,
  conversationPresenceLabel,
  formatBubbleTimestamp,
  formatInboxTimestamp,
  formatMessageStatusDescription,
  isComposerSendable,
  isPinnedToLatest,
  isVisibleChatMessage,
  mergeChatWindow,
  paginateConversationMessages,
  shouldAutoScrollOnIncoming,
  shouldMarkConversationRead,
  sortInboxConversations,
  userFacingSendError,
} from "../src/conversationUi.js";
import { sameLogicalIdentity } from "../src/lifecycle.js";

function row(
  message_id: string,
  sender_id: string,
  send_seq: number,
  created_at: string,
  status = MessageStatus.SENT,
  conversation_id = "convo-a",
) {
  return { message_id, sender_id, send_seq, created_at, conversation_id, status };
}

describe("conversation UI helpers", () => {
  it("paginates 1000 canonically ordered messages without reordering or duplicating", () => {
    const started = Date.now();
    const messages = Array.from({ length: 1000 }, (_, i) =>
      row(
        `id-${String(i).padStart(4, "0")}`,
        i % 2 === 0 ? "alice" : "bob",
        Math.floor(i / 2) + 1,
        `2026-08-16T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`,
      ),
    );
    const first = paginateConversationMessages(messages, { limit: 50 });
    expect(first.rows).toHaveLength(50);
    expect(first.hasOlder).toBe(true);
    expect(first.rows[0]?.message_id).toBe("id-0950");
    expect(first.rows[49]?.message_id).toBe("id-0999");

    const older = paginateConversationMessages(messages, {
      beforeMessageId: first.rows[0]?.message_id,
      limit: 50,
    });
    expect(older.rows).toHaveLength(50);
    expect(older.rows[49]?.message_id).toBe("id-0949");
    const merged = mergeChatWindow(first.rows, older.rows);
    expect(merged).toHaveLength(100);
    expect(merged.map((item) => item.message_id)).toEqual([...older.rows, ...first.rows].map((item) => item.message_id));
    expect(new Set(merged.map((item) => item.message_id)).size).toBe(100);
    expect(CHAT_PAGE_SIZE).toBe(50);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("does not yank newer messages when loading older history", () => {
    const messages = Array.from({ length: 5 }, (_, i) =>
      row(`m${i}`, "alice", i + 1, `2026-08-16T00:00:0${i}.000Z`),
    );
    const latest = paginateConversationMessages(messages, { limit: 2 });
    const older = paginateConversationMessages(messages, { beforeMessageId: latest.rows[0]!.message_id, limit: 2 });
    expect(latest.rows.map((item) => item.message_id)).toEqual(["m3", "m4"]);
    expect(older.rows.map((item) => item.message_id)).toEqual(["m1", "m2"]);
  });

  it("suppresses duplicate BLE and HTTPS copies of the same logical message", () => {
    const ble = row("msg-1", "alice", 1, "2026-08-16T00:00:00.000Z", MessageStatus.SENT);
    const https = { ...ble, created_at: "2026-08-16T00:00:09.000Z", status: MessageStatus.SENT };
    expect(sameLogicalIdentity(ble, https)).toBe(true);
    const merged = mergeChatWindow([ble], [https]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.message_id).toBe("msg-1");
  });

  it("applies rapid receipt bursts without duplicating or regressing READ", () => {
    const sent = row("msg-1", "alice", 1, "2026-08-16T00:00:00.000Z", MessageStatus.SENT);
    const delivered = { ...sent, status: MessageStatus.DELIVERED };
    const read = { ...sent, status: MessageStatus.READ };
    const lateDelivered = { ...sent, status: MessageStatus.DELIVERED };
    let window = mergeChatWindow([], [sent]);
    window = mergeChatWindow(window, [delivered, read, lateDelivered, delivered]);
    expect(window).toHaveLength(1);
    expect(window[0]?.status).toBe(MessageStatus.READ);
    expect(mergePersistedStatus(MessageStatus.READ, MessageStatus.DELIVERED)).toBe(MessageStatus.READ);
  });

  it("orders inbox by last visible chat activity, not delayed ACKs or retries", () => {
    const olderLast = row("old", "bob", 1, "2026-08-16T00:00:00.000Z", MessageStatus.SENT, "convo-old");
    const newerLast = row("new", "alice", 1, "2026-08-16T00:10:00.000Z", MessageStatus.QUEUED, "convo-new");
    const items = [
      { id: "convo-old", created_at: "2026-08-01T00:00:00.000Z", last: { ...olderLast, status: MessageStatus.READ } },
      { id: "convo-new", created_at: "2026-07-01T00:00:00.000Z", last: newerLast },
    ];
    const acked = [
      { id: "convo-old", created_at: items[0]!.created_at, last: { ...olderLast, status: MessageStatus.READ } },
      { id: "convo-new", created_at: items[1]!.created_at, last: { ...newerLast, status: MessageStatus.SENT } },
    ];
    expect(sortInboxConversations(items).map((item) => item.id)).toEqual(["convo-new", "convo-old"]);
    expect(sortInboxConversations(acked).map((item) => item.id)).toEqual(["convo-new", "convo-old"]);
    const retried = [
      items[0]!,
      { id: "convo-new", created_at: items[1]!.created_at, last: { ...newerLast, status: MessageStatus.RETRYING } },
    ];
    expect(sortInboxConversations(retried).map((item) => item.id)).toEqual(["convo-new", "convo-old"]);
  });

  it("never marks READ from background, inactive, or unfocused screens", () => {
    expect(shouldMarkConversationRead({ isConversationScreenFocused: true, appState: "active" })).toBe(true);
    expect(shouldMarkConversationRead({ isConversationScreenFocused: true, appState: "background" })).toBe(false);
    expect(shouldMarkConversationRead({ isConversationScreenFocused: true, appState: "inactive" })).toBe(false);
    expect(shouldMarkConversationRead({ isConversationScreenFocused: false, appState: "active" })).toBe(false);
  });

  it("auto-scrolls the user's send and incoming only when pinned to latest", () => {
    expect(shouldAutoScrollOnIncoming({ fromSelf: true, pinnedToLatest: false })).toBe(true);
    expect(shouldAutoScrollOnIncoming({ fromSelf: false, pinnedToLatest: true })).toBe(true);
    expect(shouldAutoScrollOnIncoming({ fromSelf: false, pinnedToLatest: false })).toBe(false);
    expect(isPinnedToLatest(0)).toBe(true);
    expect(isPinnedToLatest(80)).toBe(false);
  });

  it("disables empty composer text and clamps to the protocol plaintext cap", () => {
    expect(isComposerSendable("")).toBe(false);
    expect(isComposerSendable("   ")).toBe(false);
    expect(isComposerSendable("hello")).toBe(true);
    expect(isComposerSendable("hello", { sending: true })).toBe(false);
    expect(isComposerSendable("x".repeat(MAX_APPLICATION_TEXT_CHARS + 1))).toBe(false);
    expect(clampComposerText("abcde", 3)).toBe("abc");
  });

  it("hides ciphertext from chat lists and maps presence without transport selection", () => {
    expect(isVisibleChatMessage({ kind: "delivery_ack", encrypted_payload: "x", local_seal: null })).toBe(false);
    expect(isVisibleChatMessage({ kind: "message", encrypted_payload: "", local_seal: null })).toBe(false);
    expect(isVisibleChatMessage({ kind: "message", encrypted_payload: "box", local_seal: null })).toBe(true);
    expect(conversationPresenceLabel("nearby")).toBe("Nearby");
    expect(conversationPresenceLabel("online")).toBe("Online");
    expect(conversationPresenceLabel("queued")).toBe("Queued");
  });

  it("formats timestamps and readable status descriptions", () => {
    const now = new Date(2026, 7, 17, 15, 4, 0);
    const yesterday = new Date(2026, 7, 16, 15, 4, 0);
    expect(formatInboxTimestamp(now.toISOString(), now).length).toBeGreaterThan(0);
    expect(formatInboxTimestamp(yesterday.toISOString(), now)).toBe("Yesterday");
    expect(formatBubbleTimestamp("not-a-date")).toBe("");
    expect(formatMessageStatusDescription(MessageStatus.QUEUED)).toBe("Queued, waiting to send");
    expect(formatMessageStatusDescription(MessageStatus.FAILED)).toBe("Failed, retry available");
    expect(formatMessageStatusDescription(MessageStatus.READ)).toBe("Read");
    expect(formatMessageStatusDescription(MessageStatus.RETRYING, 2)).toBe("Retrying send");
  });

  it("does not expose crypto, database, or stack internals in send errors", () => {
    expect(userFacingSendError(new Error("crypto_box_easy failed"))).toBe("Could not send this message securely.");
    expect(userFacingSendError(new Error("SQLITE_CONSTRAINT"))).toBe("Could not send this message.");
    expect(userFacingSendError(new Error("TypeError: Cannot read properties of undefined"))).toBe(
      "Could not send this message.",
    );
    expect(userFacingSendError(new Error("Peer identity key changed; re-verify before sending"))).toBe(
      "Recipient identity changed. Re-verify before sending.",
    );
    expect(userFacingSendError(new Error("network down"))).toBe("You're offline. The message will send when you're back.");
    expect(userFacingSendError(new Error("Bluetooth off"))).toBe("Bluetooth is unavailable.");
    expect(userFacingSendError(new Error("encrypted_payload AAAAA"))).toBe("Could not send this message.");
  });
});
