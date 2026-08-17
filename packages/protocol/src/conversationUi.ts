import { conversationIsActivelyViewed, mergePersistedStatus } from "./acks.js";
import { MAX_APPLICATION_TEXT_CHARS } from "./cryptoBox.js";
import {
  type ConversationOrderFields,
  compareMergeKey,
  sameLogicalIdentity,
  sortConversationMessages,
} from "./lifecycle.js";
import { MessageStatus } from "./message.js";
import { categorizeTransportFailure } from "./transportErrors.js";
import { formatMessageStatus, type ConversationRoute } from "./conversationTransport.js";
import { redactString } from "./redact.js";
import type { StoredMessage } from "./store.js";

/** Visible history window. Do not load an unbounded conversation into the chat list. */
export const CHAT_PAGE_SIZE = 50;

export type ChatPageOptions = {
  beforeMessageId?: string | null;
  limit?: number;
};

export type ChatPage<T extends ConversationOrderFields> = {
  rows: T[];
  hasOlder: boolean;
};

export type InboxActivityFields = ConversationOrderFields & {
  conversation_id?: string;
};

export type InboxSortItem = {
  id: string;
  created_at: string;
  last?: InboxActivityFields | null;
};

/**
 * Slice a canonically ordered conversation (oldest first) without reordering newer
 * rows or inventing identities. `beforeMessageId` is the oldest currently loaded id.
 */
export function paginateConversationMessages<T extends ConversationOrderFields>(
  rows: T[],
  options: ChatPageOptions = {},
): ChatPage<T> {
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit ?? CHAT_PAGE_SIZE)) : CHAT_PAGE_SIZE;
  const sorted = sortConversationMessages(rows);
  let end = sorted.length;
  if (options.beforeMessageId) {
    const idx = sorted.findIndex((row) => row.message_id === options.beforeMessageId);
    if (idx <= 0) return { rows: [], hasOlder: false };
    end = idx;
  }
  const start = Math.max(0, end - limit);
  return {
    rows: sorted.slice(start, end),
    hasOlder: start > 0,
  };
}

/**
 * Merge a live window with newly listed/paged rows. Duplicate BLE/HTTPS copies collapse
 * to one identity. Receipts never regress SENT → DELIVERED → READ.
 */
export function mergeChatWindow<T extends ConversationOrderFields & { status?: string; conversation_id?: string }>(
  existing: T[],
  incoming: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const row of existing) {
    byId.set(row.message_id, row);
  }
  for (const row of incoming) {
    const prev = byId.get(row.message_id);
    if (prev) {
      if (!sameLogicalIdentity(prev, row)) continue;
      const status =
        prev.status && row.status ? mergePersistedStatus(prev.status, row.status) : (row.status ?? prev.status);
      byId.set(row.message_id, { ...prev, ...row, status });
      continue;
    }
    byId.set(row.message_id, row);
  }
  return sortConversationMessages([...byId.values()]);
}

export function inboxActivityKey(item: InboxSortItem): ConversationOrderFields {
  if (item.last?.message_id) {
    return {
      message_id: item.last.message_id,
      sender_id: item.last.sender_id,
      created_at: item.last.created_at,
      send_seq: item.last.send_seq ?? null,
    };
  }
  return {
    message_id: item.id,
    sender_id: "",
    created_at: item.created_at,
    send_seq: 0,
  };
}

/**
 * Most recent valid chat activity first. Last visible message identity is the key —
 * retries, duplicate packets, and delayed ACKs do not invent a newer activity time.
 */
export function sortInboxConversations<T extends InboxSortItem>(items: T[]): T[] {
  return [...items].sort((a, b) => compareMergeKey(inboxActivityKey(b), inboxActivityKey(a)));
}

export function isComposerSendable(
  text: string,
  options: { sending?: boolean; maxChars?: number } = {},
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (options.sending) return false;
  const max = options.maxChars ?? MAX_APPLICATION_TEXT_CHARS;
  return trimmed.length <= max;
}

export function clampComposerText(text: string, maxChars = MAX_APPLICATION_TEXT_CHARS): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

export function formatInboxTimestamp(iso: string, now = new Date()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const then = new Date(t);
  if (then.toDateString() === now.toDateString()) {
    return then.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return "Yesterday";
  const deltaDays = (now.getTime() - t) / 86_400_000;
  if (deltaDays >= 0 && deltaDays < 7) {
    return then.toLocaleDateString([], { weekday: "short" });
  }
  return then.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatBubbleTimestamp(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function formatMessageStatusDescription(status: string, retryAttempts = 0): string {
  const label = formatMessageStatus(status, retryAttempts);
  switch (label) {
    case "Queued":
      return "Queued, waiting to send";
    case "Sending":
      return "Sending";
    case "Retrying":
      return "Retrying send";
    case "Sent":
      return "Sent";
    case "Delivered":
      return "Delivered";
    case "Read":
      return "Read";
    case "Failed":
      return status === MessageStatus.EXPIRED ? "Expired, cannot retry" : "Failed, retry available";
    case "Relaying":
      return "Relaying";
    default:
      return "Message status unavailable";
  }
}

export function conversationPresenceLabel(route: ConversationRoute): string {
  if (route === "nearby") return "Nearby";
  if (route === "online") return "Online";
  if (route === "queued") return "Queued";
  if (route === "relaying") return "Relaying";
  return "Offline";
}

export function shouldMarkConversationRead(input: {
  isConversationScreenFocused: boolean;
  appState: string;
}): boolean {
  return conversationIsActivelyViewed(input);
}

export function shouldAutoScrollOnIncoming(input: { fromSelf: boolean; pinnedToLatest: boolean }): boolean {
  return input.fromSelf || input.pinnedToLatest;
}

export function isPinnedToLatest(contentOffsetY: number, threshold = 48): boolean {
  return contentOffsetY <= threshold;
}

const INTERNAL_ERROR =
  /sql|sqlite|crypto_box|ciphertext|stack|typeerror|referenceerror|libsodium|nonce|secret|database|constraint|uuid|message_id|encrypted_payload|local_seal/i;

export function userFacingSendError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const redacted = redactString(raw);
  const category = categorizeTransportFailure(raw);
  if (/cannot send without a real recipient/i.test(raw)) {
    return "Cannot send without a real recipient";
  }
  if (/key changed|re-verify/i.test(raw)) {
    return "Recipient identity changed. Re-verify before sending.";
  }
  if (/has not published an identity/i.test(raw)) {
    return "This person is not available to message yet.";
  }
  if (/bluetooth/i.test(raw) && /unavail|off|permission/i.test(raw)) {
    return "Bluetooth is unavailable.";
  }
  if (category === "identity_changed") return "Recipient identity changed. Re-verify before sending.";
  if (category === "crypto_refused") return "Could not send this message securely.";
  if (category === "unavailable") return "Recipient is unavailable right now.";
  if (category === "network") return "You're offline. The message will send when you're back.";
  if (category === "timeout") return "Delivery is taking longer than expected.";
  if (category === "session_stale") return "Connection ended. The message is queued.";
  if (category === "http_5xx") return "Could not reach the server. Try again shortly.";
  if (category === "http_4xx") return "Could not send this message.";
  if (category === "malformed") return "Could not send this message.";
  if (!raw || INTERNAL_ERROR.test(raw) || INTERNAL_ERROR.test(redacted)) {
    return "Could not send this message.";
  }
  if (redacted.length > 120) return "Could not send this message.";
  return redacted;
}

export function userFacingLoadError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!raw || INTERNAL_ERROR.test(raw)) return "Could not load messages.";
  return userFacingSendError(error);
}

export function isVisibleChatMessage(row: Pick<StoredMessage, "kind" | "encrypted_payload" | "local_seal">): boolean {
  if (row.kind === "delivery_ack") return false;
  return Boolean(row.encrypted_payload || row.local_seal);
}
