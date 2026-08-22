import type { ApplicationPlaintext, DecryptOptions } from "./cryptoBox.js";
import { isCryptoBoxPayload, MAX_APPLICATION_TEXT_CHARS, parseCryptoBoxPayload } from "./cryptoBox.js";
import type { HopHttpClient } from "./http.js";
import { createMessageId } from "./ids.js";
import {
  ACK_PROTOCOL_VERSION,
  AckType,
  ackStatusFromType,
  ackTypeFromStatus,
  parseAckPlain,
} from "./acks.js";
import {
  MAX_OUTBOX_MESSAGES,
  isOutboxStatus,
  isTransportAcceptedStatus,
  sameLogicalIdentity,
  sortConversationMessages,
} from "./lifecycle.js";
import { DEFAULT_TTL_MS, MessageStatus, isExpired } from "./message.js";
import { DEFAULT_RETRY_POLICY, nextBackoffMs, type RetryPolicy } from "./retry.js";
import { eventChatFanoutRecipients, shouldApplyDirectInboxSafety } from "./events.js";
import { requirePeerRecipient } from "./sendGuards.js";
import { canTransition, transition } from "./stateMachine.js";
import type { HopSqliteStore, StoredMessage } from "./store.js";
import type { PublicKeyTofu } from "./tofu.js";
import type { EncryptedEnvelope, NetworkStatus, TransportId } from "./transport.js";
import type { TransportManager } from "./transportManager.js";
import {
  DEFAULT_VOICE_CAPTION,
  DEFAULT_VOICE_CODEC,
  DEFAULT_VOICE_MIME,
  MAX_ENCRYPTED_PAYLOAD_BYTES,
  assertEncryptedPayloadSize,
  assertVoiceFitsBudget,
  estimateBoxedPayloadBytes,
  withDecryptedPlain,
} from "./voice.js";
import { conversationPreviewLine } from "./conversationTransport.js";
import {
  CHAT_PAGE_SIZE,
  isVisibleChatMessage,
  paginateConversationMessages,
  sortInboxConversations,
  type ChatPageOptions,
} from "./conversationUi.js";
import { SafetyError, type SafetyDecision, type SafetyGate } from "./safety.js";

export interface SendTextInput {
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  text: string;
  now?: Date;
  /** Reuse a canonical id after an in-memory encrypt failure. Never invent a second identity. */
  message_id?: string;
  send_seq?: number;
  /** Fires after the canonical id is allocated and before encrypt/flush. */
  onAllocated?: (row: StoredMessage) => void;
}

export interface SendEventTextInput {
  conversation_id: string;
  sender_id: string;
  recipient_ids: readonly string[];
  text: string;
  archived?: boolean;
  now?: Date;
  onAllocated?: (row: StoredMessage) => void;
}

export interface SendVoiceInput {
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  audio_b64: string;
  duration_ms: number;
  mime?: string;
  codec?: string;
  text?: string;
  now?: Date;
  /** Reuse a canonical id after an in-memory encrypt failure. Never invent a second identity. */
  message_id?: string;
  send_seq?: number;
  onAllocated?: (row: StoredMessage) => void;
}

export interface MessageCrypto {
  encrypt(plain: ApplicationPlaintext): Promise<string>;
  /** Self-encrypted copy for displaying sent messages without storing plaintext. */
  sealLocal?(plain: ApplicationPlaintext): Promise<string>;
  decrypt(
    payload: string,
    expectedSenderPk?: string,
    expectedMessageId?: string,
    options?: DecryptOptions,
  ): Promise<ApplicationPlaintext>;
}

export class MessageService {
  private readonly conversationTails = new Map<string, Promise<unknown>>();
  private readonly flushLocks = new Map<string, Promise<unknown>>();
  private syncTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: HopSqliteStore,
    private readonly manager: TransportManager,
    private readonly http: HopHttpClient,
    private readonly getToken: () => string | null,
    private readonly crypto?: MessageCrypto,
    private readonly tofu?: PublicKeyTofu,
    private readonly retry: RetryPolicy = DEFAULT_RETRY_POLICY,
    private safety: SafetyGate | null = null,
  ) {}

  attachSafety(safety: SafetyGate | null): void {
    this.safety = safety;
  }

  private async assertOutboundAllowed(recipientId: string, retryMessageId?: string): Promise<SafetyDecision | null> {
    if (!this.safety) return null;
    const decision = await this.safety.decideOutbound(recipientId);
    if (decision.allow) return decision;
    if (retryMessageId && (await this.store.getMessage(retryMessageId))) {
      return { allow: true };
    }
    throw new SafetyError(decision.code, decision.message);
  }

  private enqueueConversation<T>(conversationId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.conversationTails.get(conversationId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.conversationTails.set(
      conversationId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private withFlushLock<T>(messageId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.flushLocks.get(messageId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.flushLocks.set(
      messageId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  async sendText(input: SendTextInput): Promise<StoredMessage> {
    return this.enqueueConversation(input.conversation_id, () => this.sendTextUnlocked(input));
  }

  async sendEventText(input: SendEventTextInput): Promise<StoredMessage> {
    return this.enqueueConversation(input.conversation_id, () => this.sendEventTextUnlocked(input));
  }

  private async sendTextUnlocked(input: SendTextInput): Promise<StoredMessage> {
    if (!this.crypto) {
      throw new Error("Refusing to send without libsodium crypto_box keys");
    }
    const recipient_id = requirePeerRecipient(input.sender_id, input.recipient_id);
    const outboundDecision = await this.assertOutboundAllowed(recipient_id, input.message_id);
    const text = input.text.trim();
    if (!text) {
      throw new Error("Refusing to encrypt empty plaintext");
    }
    if (text.length > MAX_APPLICATION_TEXT_CHARS) {
      throw new Error("Message is too long");
    }
    if (input.message_id) {
      const existing = await this.store.getMessage(input.message_id);
      if (existing) {
        if (existing.sender_id !== input.sender_id || existing.conversation_id !== input.conversation_id) {
          throw new Error("Could not send this message");
        }
        if (existing.status === MessageStatus.FAILED) {
          const retried = await this.retryFailedUnlocked(existing.message_id, input.now ?? new Date());
          if (retried) return retried;
        }
        const opened = await this.materializePlaintext(existing);
        this.notifyAllocated({ ...opened, text: opened.text ?? text }, input.onAllocated);
        return opened;
      }
    }
    const now = input.now ?? new Date();
    const created_at = now.toISOString();
    const expires_at = new Date(now.getTime() + DEFAULT_TTL_MS).toISOString();
    const message_id = input.message_id ?? createMessageId();
    const send_seq = input.send_seq ?? (await this.store.nextSendSeq(input.conversation_id, input.sender_id));
    const plain: ApplicationPlaintext = {
      message_id,
      sender_id: input.sender_id,
      recipient_id,
      conversation_id: input.conversation_id,
      text,
      created_at,
      expires_at,
      ttl: DEFAULT_TTL_MS,
      hop_count: 0,
      send_seq,
    };
    let record: StoredMessage = {
      message_id,
      conversation_id: input.conversation_id,
      sender_id: input.sender_id,
      recipient_id,
      text,
      encrypted_payload: "",
      local_seal: null,
      status: MessageStatus.CREATED,
      transport: "local",
      created_at,
      expires_at,
      ttl: DEFAULT_TTL_MS,
      hop_count: 0,
      send_seq,
      kind: "message",
    };
    record = this.withStatus(record, MessageStatus.ENCRYPTING);
    this.notifyAllocated(record, input.onAllocated);
    let local_seal: string | null = null;
    try {
      if (this.crypto.sealLocal) {
        local_seal = await this.crypto.sealLocal(plain);
      }
      const encrypted_payload = await this.crypto.encrypt(plain);
      if (!isCryptoBoxPayload(encrypted_payload)) {
        throw new Error("encrypt() must return a libsodium crypto_box payload");
      }
      record = {
        ...record,
        encrypted_payload,
        local_seal,
      };
      record = this.withStatus(record, MessageStatus.ENCRYPTED);
      await this.persistMessage(record);
      record = this.withStatus(record, MessageStatus.QUEUED);
      if (this.safety && outboundDecision?.allow && outboundDecision.asRequest) {
        await this.safety.recordOutboundIntro(recipient_id, record.message_id);
      }
      return this.persistAndFlush(record, now, text);
    } catch (err) {
      if (local_seal && isCryptoBoxPayload(local_seal)) {
        const failed = this.withStatus(
          { ...record, local_seal, text: null, encrypted_payload: "" },
          MessageStatus.FAILED,
        );
        await this.persistMessage(failed);
      }
      throw err;
    }
  }

  private async sendEventTextUnlocked(input: SendEventTextInput): Promise<StoredMessage> {
    if (!this.crypto) {
      throw new Error("Refusing to send without libsodium crypto_box keys");
    }
    if (input.archived) {
      throw new Error("Event chat is archived");
    }
    const recipients = eventChatFanoutRecipients(input.recipient_ids, input.sender_id).map((id) =>
      requirePeerRecipient(input.sender_id, id),
    );
    if (recipients.length === 0) {
      throw new Error("Cannot send without a real recipient");
    }
    const text = input.text.trim();
    if (!text) {
      throw new Error("Refusing to encrypt empty plaintext");
    }
    if (text.length > MAX_APPLICATION_TEXT_CHARS) {
      throw new Error("Message is too long");
    }
    const now = input.now ?? new Date();
    const created_at = now.toISOString();
    const expires_at = new Date(now.getTime() + DEFAULT_TTL_MS).toISOString();
    const message_id = createMessageId();
    const send_seq = await this.store.nextSendSeq(input.conversation_id, input.sender_id);
    const displayRecipient = recipients[0]!;
    const displayPlain: ApplicationPlaintext = {
      message_id,
      sender_id: input.sender_id,
      recipient_id: displayRecipient,
      conversation_id: input.conversation_id,
      text,
      created_at,
      expires_at,
      ttl: DEFAULT_TTL_MS,
      hop_count: 0,
      send_seq,
    };
    let record: StoredMessage = {
      message_id,
      conversation_id: input.conversation_id,
      sender_id: input.sender_id,
      recipient_id: displayRecipient,
      text,
      encrypted_payload: "",
      local_seal: null,
      status: MessageStatus.CREATED,
      transport: "local",
      created_at,
      expires_at,
      ttl: DEFAULT_TTL_MS,
      hop_count: 0,
      send_seq,
      kind: "message",
    };
    record = this.withStatus(record, MessageStatus.ENCRYPTING);
    this.notifyAllocated(record, input.onAllocated);
    let local_seal: string | null = null;
    try {
      if (this.crypto.sealLocal) {
        local_seal = await this.crypto.sealLocal(displayPlain);
      }
      const copies: Array<{ recipient_id: string; encrypted_payload: string; message_id: string }> = [];
      for (const recipient_id of recipients) {
        const copyId = recipient_id === displayRecipient ? message_id : createMessageId();
        const encrypted_payload = await this.crypto.encrypt({
          ...displayPlain,
          message_id: copyId,
          recipient_id,
        });
        if (!isCryptoBoxPayload(encrypted_payload)) {
          throw new Error("encrypt() must return a libsodium crypto_box payload");
        }
        copies.push({ recipient_id, encrypted_payload, message_id: copyId });
      }
      const primary = copies.find((copy) => copy.message_id === message_id) ?? copies[0]!;
      record = {
        ...record,
        encrypted_payload: primary.encrypted_payload,
        local_seal,
      };
      record = this.withStatus(record, MessageStatus.ENCRYPTED);
      await this.persistMessage(record);
      record = this.withStatus(record, MessageStatus.QUEUED);
      await this.persistMessage(record);
      record = this.withStatus(record, MessageStatus.SENDING);
      await this.persistMessage(record);
      const res = await this.http.request(`/conversations/${input.conversation_id}/messages`, {
        method: "POST",
        body: { copies },
      });
      if (!res.ok) {
        const failed = this.withStatus(record, MessageStatus.FAILED);
        await this.persistMessage(failed);
        throw new Error("Could not send this message");
      }
      const sent = this.withStatus(record, MessageStatus.SENT);
      await this.persistMessage(sent);
      return { ...sent, text };
    } catch (err) {
      if (local_seal && isCryptoBoxPayload(local_seal)) {
        const failed = this.withStatus(
          { ...record, local_seal, text: null, encrypted_payload: record.encrypted_payload || "" },
          MessageStatus.FAILED,
        );
        await this.persistMessage(failed);
      }
      throw err;
    }
  }

  async sendVoice(input: SendVoiceInput): Promise<StoredMessage> {
    return this.enqueueConversation(input.conversation_id, () => this.sendVoiceUnlocked(input));
  }

  private async sendVoiceUnlocked(input: SendVoiceInput): Promise<StoredMessage> {
    if (!this.crypto) {
      throw new Error("Refusing to send without libsodium crypto_box keys");
    }
    const recipient_id = requirePeerRecipient(input.sender_id, input.recipient_id);
    const outboundDecision = await this.assertOutboundAllowed(recipient_id, input.message_id);
    assertVoiceFitsBudget({ audio_b64: input.audio_b64, duration_ms: input.duration_ms });
    if (input.message_id) {
      const existing = await this.store.getMessage(input.message_id);
      if (existing) {
        if (existing.sender_id !== input.sender_id || existing.conversation_id !== input.conversation_id) {
          throw new Error("Could not send this message");
        }
        if (existing.status === MessageStatus.FAILED) {
          const retried = await this.retryFailedUnlocked(existing.message_id, input.now ?? new Date());
          if (retried) {
            const opened = await this.materializePlaintext(retried);
            this.notifyAllocated(opened, input.onAllocated);
            return opened;
          }
        }
        const opened = await this.materializePlaintext(existing);
        this.notifyAllocated(opened, input.onAllocated);
        return opened;
      }
    }
    const now = input.now ?? new Date();
    const created_at = now.toISOString();
    const expires_at = new Date(now.getTime() + DEFAULT_TTL_MS).toISOString();
    const message_id = input.message_id ?? createMessageId();
    const send_seq = input.send_seq ?? (await this.store.nextSendSeq(input.conversation_id, input.sender_id));
    const caption = input.text?.trim() ? input.text.trim() : DEFAULT_VOICE_CAPTION;
    const plain: ApplicationPlaintext = {
      message_id,
      sender_id: input.sender_id,
      recipient_id,
      conversation_id: input.conversation_id,
      text: caption,
      created_at,
      expires_at,
      ttl: DEFAULT_TTL_MS,
      hop_count: 0,
      kind: "voice",
      audio_b64: input.audio_b64,
      duration_ms: input.duration_ms,
      mime: input.mime ?? DEFAULT_VOICE_MIME,
      codec: input.codec ?? DEFAULT_VOICE_CODEC,
      seq: 0,
      total: 1,
      send_seq,
    };
    if (estimateBoxedPayloadBytes(plain) > MAX_ENCRYPTED_PAYLOAD_BYTES) {
      throw new Error("Voice payload exceeds maximum size");
    }
    let record: StoredMessage = {
      message_id,
      conversation_id: input.conversation_id,
      sender_id: input.sender_id,
      recipient_id,
      text: null,
      encrypted_payload: "",
      local_seal: null,
      status: MessageStatus.CREATED,
      transport: "local",
      created_at,
      expires_at,
      ttl: DEFAULT_TTL_MS,
      hop_count: 0,
      send_seq,
      kind: "voice",
    };
    record = this.withStatus(record, MessageStatus.ENCRYPTING);
    this.notifyAllocated(withDecryptedPlain(record, plain), input.onAllocated);
    let local_seal: string | null = null;
    try {
      const encrypted_payload = await this.crypto.encrypt(plain);
      if (!isCryptoBoxPayload(encrypted_payload)) {
        throw new Error("encrypt() must return a libsodium crypto_box payload");
      }
      assertEncryptedPayloadSize(encrypted_payload);
      local_seal = this.crypto.sealLocal ? await this.crypto.sealLocal(plain) : null;
      record = { ...record, encrypted_payload, local_seal };
      record = this.withStatus(record, MessageStatus.ENCRYPTED);
      await this.persistMessage(record);
      record = this.withStatus(record, MessageStatus.QUEUED);
      if (this.safety && outboundDecision?.allow && outboundDecision.asRequest) {
        await this.safety.recordOutboundIntro(recipient_id, record.message_id);
      }
      const sent = await this.persistAndFlush(record, now, null);
      return withDecryptedPlain(sent, plain);
    } catch (err) {
      if (local_seal && isCryptoBoxPayload(local_seal)) {
        const failed = this.withStatus(
          { ...record, local_seal, text: null, encrypted_payload: record.encrypted_payload || "" },
          MessageStatus.FAILED,
        );
        await this.persistMessage(failed);
      }
      throw err;
    }
  }

  private async persistAndFlush(
    record: StoredMessage,
    now: Date,
    displayText: string | null,
  ): Promise<StoredMessage> {
    await this.rememberSelf(record.sender_id);
    if (record.kind !== "delivery_ack" && (await this.store.queuedCount()) >= MAX_OUTBOX_MESSAGES) {
      const failed = this.withStatus(record, MessageStatus.FAILED);
      await this.persistMessage(failed);
      return displayText ? { ...failed, text: displayText } : failed;
    }
    await this.store.saveQueuedOutbound(this.storedRecord(record), 0, now.getTime());
    if (record.kind !== "delivery_ack") {
      await this.applyPendingInboundReceipts(record.message_id);
    }
    const flushed = await this.flushOne({ ...record, text: displayText }, now, true);
    return displayText ? { ...flushed, text: displayText } : flushed;
  }

  async listMessages(conversationId: string): Promise<StoredMessage[]> {
    return this.materializeVisible(await this.listVisibleStored(conversationId));
  }

  async listMessagesPage(
    conversationId: string,
    options: ChatPageOptions = {},
  ): Promise<{ rows: StoredMessage[]; hasOlder: boolean }> {
    const visible = await this.listVisibleStored(conversationId);
    const page = paginateConversationMessages(visible, {
      beforeMessageId: options.beforeMessageId,
      limit: options.limit ?? CHAT_PAGE_SIZE,
    });
    return { rows: await this.materializeVisible(page.rows), hasOlder: page.hasOlder };
  }

  async unreadCount(conversationId: string, viewerId: string): Promise<number> {
    return this.store.unreadCount(conversationId, viewerId);
  }

  async unreadCounts(viewerId: string): Promise<Record<string, number>> {
    return this.store.unreadCounts(viewerId);
  }

  async previewForConversation(conversationId: string): Promise<string> {
    const last = await this.latestVisible(conversationId);
    return conversationPreviewLine(last ?? null);
  }

  async listInbox(viewerId: string): Promise<
    Array<{
      id: string;
      peer_id: string | null;
      peer_username: string | null;
      peer_public_key: string | null;
      created_at: string;
      preview: string;
      unread: number;
      last: StoredMessage | null;
      kind?: "direct" | "event" | null;
      title?: string | null;
      event_id?: string | null;
      archived?: boolean;
    }>
  > {
    const convos = await this.store.listConversations();
    const unreads = await this.unreadCounts(viewerId);
    const items = [];
    for (const convo of convos) {
      if (this.safety && convo.peer_id && shouldApplyDirectInboxSafety(convo.kind)) {
        const visibility = await this.safety.inboxVisibility(convo.peer_id);
        if (visibility !== "chat") continue;
      }
      const last = await this.latestVisible(convo.id);
      items.push({
        id: convo.id,
        peer_id: convo.peer_id,
        peer_username: convo.peer_username,
        peer_public_key: convo.peer_public_key,
        created_at: convo.created_at,
        preview: conversationPreviewLine(last ?? null),
        unread: unreads[convo.id] ?? 0,
        last,
        kind: convo.kind ?? "direct",
        title: convo.title ?? null,
        event_id: convo.event_id ?? null,
        archived: Boolean(convo.archived),
      });
    }
    return sortInboxConversations(items);
  }

  async getNetworkStatus(): Promise<NetworkStatus> {
    const syncing = await this.store.getSyncValue("status");
    if (syncing === "Synchronizing") return "Synchronizing";
    const internet = this.manager.getTransport("internet");
    if (internet && (await internet.isAvailable())) return "Online";
    if ((await this.store.queuedCount()) > 0) return "Queued";
    return this.manager.getNetworkStatus();
  }

  async sync(now = new Date()): Promise<void> {
    const run = this.syncTail.then(
      () => this.syncUnlocked(now),
      () => this.syncUnlocked(now),
    );
    this.syncTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async syncUnlocked(now: Date): Promise<void> {
    await this.recoverInFlight(now);
    const internet = this.manager.getTransport("internet");
    const online = Boolean(internet && (await internet.isAvailable()));
    if (online) {
      await this.store.setSyncValue("status", "Synchronizing");
    }
    const outbound = await this.store.listOutbound();
    for (const item of outbound) {
      const message = await this.store.getMessage(item.message_id);
      if (!message) {
        await this.store.removeOutbound(item.message_id);
        continue;
      }
      await this.flushOne(message, now, true);
    }
    if (!online) {
      const queued = (await this.store.queuedCount()) > 0;
      const nearby = await this.manager.getNetworkStatus();
      await this.store.setSyncValue("status", queued ? "Queued" : nearby === "Nearby" ? "Nearby" : "Offline");
      return;
    }
    for (const conversationId of await this.store.listConversationIds()) {
      await this.pullConversation(conversationId);
    }
    await this.store.setSyncValue("last_sync_at", now.toISOString());
    await this.store.setSyncValue("status", "Online");
  }

  async retryDue(now = new Date()): Promise<void> {
    await this.recoverInFlight(now);
    const outbound = await this.store.listOutbound();
    for (const item of outbound) {
      if (item.next_retry_at > now.getTime()) continue;
      const message = await this.store.getMessage(item.message_id);
      if (!message) {
        await this.store.removeOutbound(item.message_id);
        continue;
      }
      await this.flushOne(message, now, false);
    }
  }

  async recoverInFlight(now = new Date()): Promise<void> {
    for (const status of [
      MessageStatus.CREATED,
      MessageStatus.ENCRYPTING,
      MessageStatus.ENCRYPTED,
      MessageStatus.SENDING,
    ]) {
      for (const message of await this.store.listMessagesByStatus(status)) {
        if (!message.encrypted_payload) {
          await this.store.deleteMessage(message.message_id);
          continue;
        }
        let recovered = message;
        if (recovered.status === MessageStatus.CREATED || recovered.status === MessageStatus.ENCRYPTING) {
          recovered = this.withStatus(recovered, MessageStatus.ENCRYPTED);
        }
        if (recovered.status === MessageStatus.ENCRYPTED) {
          recovered = this.withStatus(recovered, MessageStatus.QUEUED);
        }
        if (recovered.status === MessageStatus.SENDING) {
          recovered = this.withStatus(recovered, MessageStatus.QUEUED);
        }
        await this.persistMessage(recovered);
        const latest = await this.store.getMessage(message.message_id);
        const queued = await this.store.getOutbound(message.message_id);
        if (!queued && latest && isOutboxStatus(latest.status)) {
          await this.store.enqueue(message.message_id, 0, now.getTime());
        }
      }
    }
    for (const orphan of await this.store.listOrphanOutbox()) {
      if (!orphan.encrypted_payload) {
        await this.store.deleteMessage(orphan.message_id);
        continue;
      }
      await this.store.enqueue(orphan.message_id, 0, now.getTime());
    }
    for (const item of await this.store.listOutbound()) {
      const message = await this.store.getMessage(item.message_id);
      if (!message) {
        await this.store.removeOutbound(item.message_id);
        continue;
      }
      if (
        isTransportAcceptedStatus(message.status) ||
        message.status === MessageStatus.FAILED ||
        message.status === MessageStatus.EXPIRED
      ) {
        await this.store.removeOutbound(item.message_id);
      }
    }
    await this.recoverPendingOutboundAcks(now);
    for (const ackOf of await this.store.listInboundReceiptTargets()) {
      await this.applyPendingInboundReceipts(ackOf);
    }
    await this.store.pruneProcessed();
  }

  async retryFailed(messageId: string, now = new Date()): Promise<StoredMessage | null> {
    const message = await this.store.getMessage(messageId);
    if (!message) return null;
    if (message.status !== MessageStatus.FAILED) return message;
    return this.enqueueConversation(message.conversation_id, () => this.retryFailedUnlocked(messageId, now));
  }

  async markConversationRead(conversationId: string, readerId: string, now = new Date()): Promise<void> {
    await this.rememberSelf(readerId);
    const rows = await this.store.listMessages(conversationId);
    for (const row of rows) {
      if (row.sender_id === readerId) continue;
      if (row.kind === "delivery_ack") continue;
      if (row.status === MessageStatus.READ) continue;
      if (row.status !== MessageStatus.DELIVERED) continue;
      const opened = await this.openInbound(row);
      if (!opened.plain || opened.plain.kind === "delivery_ack") continue;
      const next = this.withStatus(row, MessageStatus.READ);
      await this.persistMessage(next);
      await this.queueAck(opened.plain, AckType.READ_ACK, now);
    }
    await this.flushPendingAcks(now);
  }

  async acceptInbound(message: StoredMessage, now = new Date()): Promise<boolean> {
    try {
      if (
        !message.message_id ||
        message.message_id.length > 128 ||
        message.encrypted_payload.length > MAX_ENCRYPTED_PAYLOAD_BYTES ||
        (typeof message.ttl === "number" && (!Number.isFinite(message.ttl) || message.ttl < 0)) ||
        (typeof message.hop_count === "number" && (!Number.isInteger(message.hop_count) || message.hop_count < 0))
      ) {
        return false;
      }
      if (isExpired(message, now)) return false;
      const existing = await this.store.getMessage(message.message_id);
      if (existing && existing.kind !== "delivery_ack") {
        if (!sameLogicalIdentity(existing, message)) return false;
        await this.persistMessage({
          ...existing,
          text: null,
          transport: message.transport || existing.transport,
          status: cryptographicStatusFromServer(existing.status, message.status),
        });
        return false;
      }
      if (!existing && (await this.store.hasProcessed(message.message_id))) {
        return false;
      }
      const opened = await this.openInbound(message);
      if (opened.plain?.kind === "delivery_ack") {
        return this.acceptCryptoDeliveryAck(message, opened.plain, now);
      }
      if (opened.plain && !(await this.inboundParticipantsAllowed(message, opened.plain))) {
        return false;
      }
      let inboundDecision: SafetyDecision | null = null;
      if (this.safety) {
        const selfId = await this.store.getSyncValue("self_user_id");
        const peerId = opened.plain?.sender_id ?? message.sender_id;
        if (peerId && peerId !== selfId) {
          inboundDecision = await this.safety.decideInbound(peerId);
          if (!inboundDecision.allow) return false;
        }
      }
      if (existing) return false;
      if (this.crypto && !isCryptoBoxPayload(message.encrypted_payload)) {
        return false;
      }
      if (isCryptoBoxPayload(message.encrypted_payload) && this.crypto && !opened.plain) {
        return false;
      }
      await this.rememberSelf(message.recipient_id);
      await this.persistMessage({
        ...opened.record,
        text: null,
        conversation_id: opened.plain?.conversation_id ?? opened.record.conversation_id,
        sender_id: opened.plain?.sender_id ?? opened.record.sender_id,
        recipient_id: opened.plain?.recipient_id ?? opened.record.recipient_id,
        created_at: opened.plain?.created_at || opened.record.created_at,
        expires_at: opened.plain?.expires_at || opened.record.expires_at,
        send_seq: opened.plain?.send_seq ?? opened.record.send_seq ?? null,
        kind: opened.plain?.kind === "voice" ? "voice" : "message",
        status: opened.plain ? MessageStatus.DELIVERED : message.status,
      });
      const fresh = await this.store.rememberProcessed(message.message_id, now);
      if (!fresh) return false;
      if (this.safety && inboundDecision && inboundDecision.allow) {
        const peerId = opened.plain?.sender_id ?? message.sender_id;
        if (inboundDecision.mutualAccept) await this.safety.markAccepted(peerId);
        else if (inboundDecision.asRequest) {
          await this.safety.recordInboundIntro(peerId, message.message_id);
        }
      }
      if (opened.plain) {
        await this.queueAck(opened.plain, AckType.DELIVERED_ACK, now);
        const mapping = await this.store.getOutboundAck(opened.plain.message_id, AckType.DELIVERED_ACK);
        if (mapping) {
          const ackRow = await this.store.getMessage(mapping.ack_message_id);
          if (ackRow) await this.flushOne(ackRow, now, true);
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  private async inboundParticipantsAllowed(
    message: StoredMessage,
    plain: ApplicationPlaintext,
  ): Promise<boolean> {
    if (plain.message_id !== message.message_id) return false;
    if (plain.conversation_id !== message.conversation_id) return false;
    if (plain.sender_id !== message.sender_id) return false;
    if (plain.recipient_id !== message.recipient_id) return false;
    const selfId = await this.store.getSyncValue("self_user_id");
    if (selfId && plain.recipient_id !== selfId && plain.sender_id !== selfId) return false;
    const convo = await this.store.getConversation(message.conversation_id);
    if (!convo?.peer_id) {
      return !selfId || plain.recipient_id === selfId || plain.sender_id === selfId;
    }
    const peer = convo.peer_id;
    const fromPeer = plain.sender_id === peer && (!selfId || plain.recipient_id === selfId);
    const fromSelf = Boolean(selfId) && plain.sender_id === selfId && plain.recipient_id === peer;
    return fromPeer || fromSelf;
  }

  private async flushOne(message: StoredMessage, now: Date, ignoreBackoff: boolean): Promise<StoredMessage> {
    return this.withFlushLock(message.message_id, async () => {
      const latest = await this.store.getMessage(message.message_id);
      if (!latest) {
        await this.store.removeOutbound(message.message_id);
        return message;
      }
      return this.flushOneUnlocked(latest, now, ignoreBackoff);
    });
  }

  private async flushOneUnlocked(message: StoredMessage, now: Date, ignoreBackoff: boolean): Promise<StoredMessage> {
    if (isExpired(message, now)) {
      const expired = this.withStatus(message, MessageStatus.EXPIRED);
      await this.persistMessage(expired);
      await this.store.removeOutbound(message.message_id);
      return expired;
    }

    if (isTransportAcceptedStatus(message.status)) {
      await this.store.removeOutbound(message.message_id);
      return message;
    }
    if (message.status === MessageStatus.FAILED || message.status === MessageStatus.EXPIRED) {
      await this.store.removeOutbound(message.message_id);
      return message;
    }

    const queued = await this.store.getOutbound(message.message_id);
    if (!ignoreBackoff && queued && queued.next_retry_at > now.getTime()) {
      return message;
    }
    if (
      message.kind !== "delivery_ack" &&
      (await this.store.hasEarlierOutbound(
        message.conversation_id,
        message.created_at,
        message.message_id,
        message.send_seq,
      ))
    ) {
      return message;
    }

    let current = message;
    if (isOutboxStatus(current.status) && current.status !== MessageStatus.SENDING) {
      current = this.advanceToward(current, MessageStatus.SENDING);
      await this.persistMessage(current);
    }

    const envelope = toStoredEnvelope(current);
    const result = await this.manager.send(envelope);
    if (result.ok) {
      let sent = this.advanceToward(current, MessageStatus.SENT);
      sent = { ...sent, transport: result.transport };
      await this.persistMessage(sent);
      await this.store.removeOutbound(sent.message_id);
      await this.store.rememberProcessed(sent.message_id, now);
      if (sent.kind === "delivery_ack") {
        await this.store.deleteMessage(sent.message_id);
      }
      return sent;
    }

    const attempts = (queued?.attempts ?? 0) + 1;
    const wait = nextBackoffMs(attempts, this.retry);
    if (wait === null) {
      const failed = this.withStatus(current, MessageStatus.FAILED);
      await this.persistMessage(failed);
      await this.store.removeOutbound(current.message_id);
      return failed;
    }
    const queuedAgain = { ...this.withStatus(current, MessageStatus.QUEUED), transport: "local" };
    await this.store.saveQueuedOutbound(this.storedRecord(queuedAgain), attempts, now.getTime() + wait);
    return queuedAgain;
  }

  async applyDeliveryAck(ackOf: string): Promise<boolean> {
    return this.applyValidatedDeliveryAck({
      kind: "delivery_ack",
      ack_of: ackOf,
      ack_status: "DELIVERED",
    });
  }

  async applyValidatedDeliveryAck(
    plain: Pick<ApplicationPlaintext, "kind" | "ack_of"> &
      Partial<
        Pick<
          ApplicationPlaintext,
          "ack_status" | "ack_type" | "ack_v" | "sender_id" | "recipient_id" | "conversation_id" | "message_id" | "text"
        >
      >,
    senderPk?: string,
  ): Promise<boolean> {
    try {
      if (plain.kind !== "delivery_ack" || !plain.ack_of) return false;
      if (plain.ack_status && plain.ack_status !== "DELIVERED" && plain.ack_status !== "READ") return false;
      const parsed =
        plain.sender_id && plain.recipient_id && plain.conversation_id
          ? parseAckPlain({
              message_id: plain.message_id ?? `local-ack:${plain.ack_of}`,
              sender_id: plain.sender_id,
              recipient_id: plain.recipient_id,
              conversation_id: plain.conversation_id,
              text: plain.text ?? "",
              created_at: "",
              expires_at: "",
              ttl: 0,
              hop_count: 0,
              kind: "delivery_ack",
              ack_of: plain.ack_of,
              ack_status: plain.ack_status,
              ack_type: plain.ack_type,
              ack_v: plain.ack_v ?? ACK_PROTOCOL_VERSION,
            })
          : null;
      if (senderPk && plain.sender_id && !parsed) return false;
      const ackType = parsed?.ack_type ?? (plain.ack_status === "READ" ? AckType.READ_ACK : AckType.DELIVERED_ACK);
      const ackStatus = parsed?.ack_status ?? ackStatusFromType(ackType);
      const existing = await this.store.getMessage(plain.ack_of);
      if (parsed) {
        if (existing) {
          if (parsed.conversation_id !== existing.conversation_id) return false;
          if (parsed.sender_id !== existing.recipient_id) return false;
          if (parsed.recipient_id !== existing.sender_id) return false;
        }
        await this.store.saveInboundReceipt({
          ack_of: parsed.ack_of,
          ack_type: parsed.ack_type,
          conversation_id: parsed.conversation_id,
          sender_id: parsed.sender_id,
          sender_pk: senderPk ?? null,
        });
        if (!existing) return true;
      } else if (plain.conversation_id && existing && plain.conversation_id !== existing.conversation_id) {
        return false;
      } else if (plain.sender_id && existing && plain.sender_id !== existing.recipient_id) {
        return false;
      } else if (plain.recipient_id && existing && plain.recipient_id !== existing.sender_id) {
        return false;
      }
      if (!existing) return false;
      const status = existing.status;
      if (
        status !== MessageStatus.SENT &&
        status !== MessageStatus.RELAYING &&
        status !== MessageStatus.DELIVERED &&
        status !== MessageStatus.READ &&
        status !== MessageStatus.FAILED
      ) {
        return false;
      }
      if (senderPk) {
        const trusted = await this.store.peerPublicKey(existing.recipient_id);
        if (trusted && trusted !== senderPk) return false;
        if (this.tofu) {
          const state = this.tofu.state(existing.recipient_id);
          if (state === "UNKNOWN") {
            if (!trusted || trusted !== senderPk) return false;
          } else if (!this.tofu.bind(existing.recipient_id, senderPk)) {
            return false;
          }
        }
      }
      const target = ackStatus === "READ" ? MessageStatus.READ : MessageStatus.DELIVERED;
      const next = this.advanceToward(existing, target);
      await this.persistMessage(next);
      return next.status === MessageStatus.DELIVERED || next.status === MessageStatus.READ;
    } catch {
      return false;
    }
  }

  private async acceptCryptoDeliveryAck(
    message: StoredMessage,
    plain: ApplicationPlaintext,
    now: Date,
  ): Promise<boolean> {
    try {
      const senderPk = parseCryptoBoxPayload(message.encrypted_payload)?.sender_pk;
      const applied = await this.applyValidatedDeliveryAck(plain, senderPk);
      const fresh = await this.store.rememberProcessed(message.message_id, now);
      return applied && fresh;
    } catch {
      return false;
    }
  }

  private async queueAck(
    original: Pick<ApplicationPlaintext, "message_id" | "sender_id" | "recipient_id" | "conversation_id">,
    ackType: (typeof AckType)[keyof typeof AckType],
    now: Date,
  ): Promise<void> {
    if (!this.crypto) return;
    const existingAck = await this.store.getOutboundAck(original.message_id, ackType);
    if (existingAck) return;
    const ack_status = ackStatusFromType(ackType);
    const ack_id = createMessageId();
    const plain: ApplicationPlaintext = {
      message_id: ack_id,
      sender_id: original.recipient_id,
      recipient_id: original.sender_id,
      conversation_id: original.conversation_id,
      text: "",
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + DEFAULT_TTL_MS).toISOString(),
      ttl: DEFAULT_TTL_MS,
      hop_count: 0,
      kind: "delivery_ack",
      ack_of: original.message_id,
      ack_status,
      ack_type: ackType,
      ack_v: ACK_PROTOCOL_VERSION,
    };
    const encrypted_payload = await this.crypto.encrypt(plain);
    if (!isCryptoBoxPayload(encrypted_payload)) {
      throw new Error("encrypt() must return a libsodium crypto_box payload");
    }
    let record: StoredMessage = {
      message_id: ack_id,
      conversation_id: original.conversation_id,
      sender_id: plain.sender_id,
      recipient_id: plain.recipient_id,
      text: null,
      encrypted_payload,
      local_seal: null,
      status: MessageStatus.CREATED,
      transport: "local",
      created_at: plain.created_at,
      expires_at: plain.expires_at,
      ttl: DEFAULT_TTL_MS,
      hop_count: 0,
      kind: "delivery_ack",
    };
    record = this.withStatus(record, MessageStatus.ENCRYPTING);
    record = this.withStatus(record, MessageStatus.ENCRYPTED);
    record = this.withStatus(record, MessageStatus.QUEUED);
    await this.persistMessage(record);
    const inserted = await this.store.saveOutboundAck(original.message_id, ackType, ack_id);
    if (!inserted) {
      await this.store.deleteMessage(ack_id);
      return;
    }
    await this.store.enqueue(record.message_id, 0, now.getTime());
  }

  private async flushPendingAcks(now: Date, ignoreBackoff = false): Promise<void> {
    const outbound = await this.store.listOutbound();
    for (const item of outbound) {
      const message = await this.store.getMessage(item.message_id);
      if (!message || message.kind !== "delivery_ack") continue;
      await this.flushOne(message, now, ignoreBackoff);
    }
  }

  private async recoverPendingOutboundAcks(now: Date): Promise<void> {
    const selfId = await this.store.getSyncValue("self_user_id");
    if (!selfId) return;
    for (const row of await this.store.listInboundNeedingAck(AckType.DELIVERED_ACK, selfId)) {
      await this.queueAck(row, AckType.DELIVERED_ACK, now);
    }
    for (const row of await this.store.listInboundNeedingAck(AckType.READ_ACK, selfId)) {
      await this.queueAck(row, AckType.READ_ACK, now);
    }
    for (const mapping of await this.store.listOutboundAcks()) {
      const ackRow = await this.store.getMessage(mapping.ack_message_id);
      if (!ackRow) continue;
      if (isTransportAcceptedStatus(ackRow.status) || ackRow.status === MessageStatus.FAILED) continue;
      const queued = await this.store.getOutbound(ackRow.message_id);
      if (!queued && isOutboxStatus(ackRow.status)) {
        await this.store.enqueue(ackRow.message_id, 0, now.getTime());
      }
    }
  }

  private applyingReceipts = false;

  private async applyPendingInboundReceipts(messageId: string): Promise<void> {
    if (this.applyingReceipts) return;
    this.applyingReceipts = true;
    try {
      const existing = await this.store.getMessage(messageId);
      if (!existing) return;
      if (
        existing.status !== MessageStatus.SENT &&
        existing.status !== MessageStatus.RELAYING &&
        existing.status !== MessageStatus.DELIVERED &&
        existing.status !== MessageStatus.READ &&
        existing.status !== MessageStatus.FAILED
      ) {
        return;
      }
      for (const receipt of await this.store.listInboundReceipts(messageId)) {
        await this.applyValidatedDeliveryAck(
          {
            kind: "delivery_ack",
            ack_of: receipt.ack_of,
            ack_type: receipt.ack_type === AckType.READ_ACK ? AckType.READ_ACK : AckType.DELIVERED_ACK,
            ack_status: receipt.ack_type === AckType.READ_ACK ? "READ" : "DELIVERED",
            sender_id: receipt.sender_id,
            recipient_id: existing.sender_id,
            conversation_id: receipt.conversation_id,
            message_id: `pending:${receipt.ack_of}:${receipt.ack_type}`,
            text: "",
          },
          receipt.sender_pk ?? undefined,
        );
      }
    } finally {
      this.applyingReceipts = false;
    }
  }

  private async rememberSelf(userId: string): Promise<void> {
    if (!userId) return;
    await this.store.setSyncValue("self_user_id", userId);
  }

  private async sendAck(
    original: ApplicationPlaintext,
    ack_status: "DELIVERED" | "READ",
    now: Date,
  ): Promise<void> {
    if (original.kind === "delivery_ack") return;
    await this.queueAck(original, ackTypeFromStatus(ack_status), now);
    await this.flushPendingAcks(now);
  }

  private async pullConversation(conversationId: string): Promise<void> {
    const token = this.getToken();
    let result: { ok: boolean; data: unknown };
    try {
      result = await this.http.request(`/conversations/${conversationId}/messages`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    } catch {
      return;
    }
    if (!result.ok || !Array.isArray(result.data)) return;
    for (const row of result.data as Array<Record<string, unknown>>) {
      const message_id = String(row.message_id ?? "");
      if (!message_id) continue;
      const conversation_id = String(row.conversation_id ?? conversationId);
      if (conversation_id !== conversationId) continue;
      const existing = await this.store.getMessage(message_id);
      if (existing && existing.conversation_id !== conversationId) continue;
      const stored: StoredMessage = {
        message_id,
        conversation_id,
        sender_id: String(row.sender_id ?? ""),
        recipient_id: String(row.recipient_id ?? ""),
        text: null,
        encrypted_payload: String(row.encrypted_payload ?? ""),
        status: cryptographicStatusFromServer(existing?.status, String(row.status ?? MessageStatus.SENT)),
        transport: String(row.transport ?? "internet"),
        created_at: String(row.created_at ?? ""),
        expires_at: String(row.expires_at ?? ""),
        ttl: Number(row.ttl ?? DEFAULT_TTL_MS),
        hop_count: Number(row.hop_count ?? 0),
      };
      await this.acceptInbound(stored);
    }
  }

  private async materializePlaintext(message: StoredMessage): Promise<StoredMessage> {
    if (message.text !== null) {
      return { ...message, text: null };
    }
    if (!this.crypto) {
      return message;
    }
    if (message.local_seal && isCryptoBoxPayload(message.local_seal)) {
      try {
        const plain = await this.crypto.decrypt(message.local_seal, undefined, message.message_id, {
          expectedSenderId: message.sender_id,
          expectedConversationId: message.conversation_id,
          tofu: this.tofu,
        });
        return withDecryptedPlain(message, plain);
      } catch {
        /* fall through to network payload */
      }
    }
    if (!isCryptoBoxPayload(message.encrypted_payload)) {
      return message;
    }
    try {
      const plain = await this.crypto.decrypt(message.encrypted_payload, undefined, message.message_id, {
        expectedSenderId: message.sender_id,
        expectedRecipientId: message.recipient_id,
        expectedConversationId: message.conversation_id,
        tofu: this.tofu,
      });
      return withDecryptedPlain(message, plain);
    } catch {
      return message;
    }
  }

  private storedRecord(message: StoredMessage): StoredMessage {
    const sealed =
      isCryptoBoxPayload(message.encrypted_payload) ||
      (typeof message.local_seal === "string" && isCryptoBoxPayload(message.local_seal));
    return {
      message_id: message.message_id,
      conversation_id: message.conversation_id,
      sender_id: message.sender_id,
      recipient_id: message.recipient_id,
      text: sealed ? null : message.text,
      encrypted_payload: message.encrypted_payload,
      local_seal: message.local_seal ?? null,
      status: message.status,
      transport: message.transport,
      created_at: message.created_at,
      expires_at: message.expires_at,
      ttl: message.ttl,
      hop_count: message.hop_count,
      send_seq: message.send_seq ?? null,
      kind: message.kind ?? null,
    };
  }

  private notifyAllocated(row: StoredMessage, onAllocated?: (row: StoredMessage) => void): void {
    if (!onAllocated) return;
    try {
      onAllocated(row);
    } catch {
      /* UI observers must not fail the send path */
    }
  }

  private async listVisibleStored(conversationId: string): Promise<StoredMessage[]> {
    const rows = await this.store.listMessages(conversationId);
    return rows.filter((row) => isVisibleChatMessage(row));
  }

  private async latestVisible(conversationId: string): Promise<StoredMessage | null> {
    const rows = await this.listVisibleStored(conversationId);
    const last = rows[rows.length - 1];
    if (!last) return null;
    const [opened] = await this.materializeVisible([last]);
    return opened ?? null;
  }

  private async materializeVisible(rows: StoredMessage[]): Promise<StoredMessage[]> {
    const outbound = await this.store.listOutbound();
    const attempts = new Map(outbound.map((row) => [row.message_id, row.attempts]));
    const out: StoredMessage[] = [];
    for (const row of rows) {
      if (!isVisibleChatMessage(row)) continue;
      const materialized = await this.materializePlaintext(row);
      if (materialized.kind === "delivery_ack") continue;
      out.push({ ...materialized, retry_attempts: attempts.get(row.message_id) ?? 0 });
    }
    return sortConversationMessages(out);
  }

  private async retryFailedUnlocked(messageId: string, now: Date): Promise<StoredMessage | null> {
    const latest = await this.store.getMessage(messageId);
    if (!latest || latest.status !== MessageStatus.FAILED) return latest;
    if ((await this.store.queuedCount()) >= MAX_OUTBOX_MESSAGES) {
      return latest;
    }
    let ready = latest;
    if (!isCryptoBoxPayload(latest.encrypted_payload) && latest.local_seal && this.crypto) {
      try {
        const plain = await this.crypto.decrypt(latest.local_seal, undefined, latest.message_id, {
          expectedSenderId: latest.sender_id,
          expectedConversationId: latest.conversation_id,
          tofu: this.tofu,
        });
        const encrypted_payload = await this.crypto.encrypt(plain);
        if (!isCryptoBoxPayload(encrypted_payload)) return latest;
        ready = { ...latest, encrypted_payload };
      } catch {
        return latest;
      }
    }
    if (!isCryptoBoxPayload(ready.encrypted_payload)) {
      return latest;
    }
    const queued = { ...this.withStatus(ready, MessageStatus.QUEUED), transport: "local" };
    await this.persistMessage(queued);
    await this.store.enqueue(queued.message_id, 0, now.getTime());
    return this.flushOne(queued, now, true);
  }

  private async persistMessage(message: StoredMessage): Promise<void> {
    const stored = this.storedRecord(message);
    await this.store.saveMessage(stored);
    if (stored.kind !== "delivery_ack") {
      await this.applyPendingInboundReceipts(stored.message_id);
    }
  }

  private async openInbound(
    message: StoredMessage,
  ): Promise<{ record: StoredMessage; plain: ApplicationPlaintext | null }> {
    if (!isCryptoBoxPayload(message.encrypted_payload) || !this.crypto) {
      return { record: { ...message, text: message.text ?? null }, plain: null };
    }
    try {
      const plain = await this.crypto.decrypt(message.encrypted_payload, undefined, message.message_id, {
        expectedSenderId: message.sender_id,
        expectedRecipientId: message.recipient_id,
        expectedConversationId: message.conversation_id,
        tofu: this.tofu,
      });
      return { record: withDecryptedPlain(message, plain), plain };
    } catch {
      return { record: { ...message, text: message.text ?? null }, plain: null };
    }
  }

  private advanceToward(message: StoredMessage, target: string): StoredMessage {
    if (message.status === target) return message;
    const steps: string[] = [];
    if (target === MessageStatus.SENDING) {
      if (message.status === MessageStatus.QUEUED || message.status === MessageStatus.RETRYING) {
        steps.push(MessageStatus.SENDING);
      }
    } else if (target === MessageStatus.SENT || target === MessageStatus.DELIVERED || target === MessageStatus.READ) {
      if (message.status === MessageStatus.QUEUED || message.status === MessageStatus.RETRYING) {
        steps.push(MessageStatus.SENDING);
      }
      if (
        message.status === MessageStatus.QUEUED ||
        message.status === MessageStatus.RETRYING ||
        message.status === MessageStatus.SENDING
      ) {
        steps.push(MessageStatus.SENT);
      }
      if (target === MessageStatus.DELIVERED || target === MessageStatus.READ) {
        if (message.status !== MessageStatus.DELIVERED && message.status !== MessageStatus.READ) {
          steps.push(MessageStatus.DELIVERED);
        }
      }
      if (target === MessageStatus.READ && message.status !== MessageStatus.READ) {
        steps.push(MessageStatus.READ);
      }
    } else if (canTransition(message.status as (typeof MessageStatus)[keyof typeof MessageStatus], target as (typeof MessageStatus)[keyof typeof MessageStatus])) {
      steps.push(target);
    }
    let current = message;
    for (const step of steps) {
      if (current.status === step) continue;
      current = this.withStatus(current, step as (typeof MessageStatus)[keyof typeof MessageStatus]);
    }
    return current;
  }

  private withStatus(message: StoredMessage, status: (typeof MessageStatus)[keyof typeof MessageStatus]): StoredMessage {
    if (message.status === status) return message;
    const hop = {
      message_id: message.message_id,
      sender_id: message.sender_id,
      recipient_id: message.recipient_id,
      conversation_id: message.conversation_id,
      encrypted_payload: message.encrypted_payload,
      created_at: message.created_at,
      expires_at: message.expires_at,
      ttl: message.ttl,
      hop_count: message.hop_count,
      transport: message.transport as "internet" | "bluetooth" | "relay" | "local",
      status: message.status as (typeof MessageStatus)[keyof typeof MessageStatus],
    };
    const next = transition(hop, status);
    return { ...message, status: next.status };
  }
}

/** Server/HTTP status is not a cryptographic ACK. Never advance past SENT from the API alone. */
function cryptographicStatusFromServer(localStatus: string | undefined, serverStatus: string): string {
  if (localStatus === MessageStatus.DELIVERED || localStatus === MessageStatus.READ) {
    return localStatus;
  }
  if (serverStatus === MessageStatus.DELIVERED || serverStatus === MessageStatus.READ) {
    return localStatus ?? MessageStatus.SENT;
  }
  return localStatus ?? serverStatus;
}

function toStoredEnvelope(message: StoredMessage): EncryptedEnvelope {
  return {
    message_id: message.message_id,
    sender_id: message.sender_id,
    recipient_id: message.recipient_id,
    conversation_id: message.conversation_id,
    encrypted_payload: message.encrypted_payload,
    created_at: message.created_at,
    expires_at: message.expires_at,
    ttl: message.ttl,
    hop_count: message.hop_count,
    transport: (message.transport as TransportId) || "local",
  };
}
