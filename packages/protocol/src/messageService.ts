import type { ApplicationPlaintext, DecryptOptions } from "./cryptoBox.js";
import { isCryptoBoxPayload } from "./cryptoBox.js";
import type { HopHttpClient } from "./http.js";
import { createMessageId } from "./ids.js";
import { DEFAULT_TTL_MS, MessageStatus, isExpired } from "./message.js";
import { DEFAULT_RETRY_POLICY, nextBackoffMs, type RetryPolicy } from "./retry.js";
import { canTransition, transition } from "./stateMachine.js";
import type { HopSqliteStore, StoredMessage } from "./store.js";
import type { EncryptedEnvelope, NetworkStatus, TransportId } from "./transport.js";
import type { TransportManager } from "./transportManager.js";

export interface SendTextInput {
  conversation_id: string;
  sender_id: string;
  recipient_id: string;
  text: string;
  now?: Date;
}

export interface MessageCrypto {
  encrypt(plain: ApplicationPlaintext): Promise<string>;
  decrypt(
    payload: string,
    expectedSenderPk?: string,
    expectedMessageId?: string,
    options?: DecryptOptions,
  ): Promise<ApplicationPlaintext>;
}

export class MessageService {
  constructor(
    private readonly store: HopSqliteStore,
    private readonly manager: TransportManager,
    private readonly http: HopHttpClient,
    private readonly getToken: () => string | null,
    private readonly crypto?: MessageCrypto,
    private readonly retry: RetryPolicy = DEFAULT_RETRY_POLICY,
  ) {}

  async sendText(input: SendTextInput): Promise<StoredMessage> {
    if (!this.crypto) {
      throw new Error("Refusing to send without libsodium crypto_box keys");
    }
    const now = input.now ?? new Date();
    const created_at = now.toISOString();
    const expires_at = new Date(now.getTime() + DEFAULT_TTL_MS).toISOString();
    const message_id = createMessageId();
    const plain: ApplicationPlaintext = {
      message_id,
      sender_id: input.sender_id,
      recipient_id: input.recipient_id,
      conversation_id: input.conversation_id,
      text: input.text,
      created_at,
      expires_at,
      ttl: DEFAULT_TTL_MS,
      hop_count: 0,
    };
    const encrypted_payload = await this.crypto.encrypt(plain);
    if (!isCryptoBoxPayload(encrypted_payload)) {
      throw new Error("encrypt() must return a libsodium crypto_box payload");
    }
    let record: StoredMessage = {
      message_id,
      conversation_id: input.conversation_id,
      sender_id: input.sender_id,
      recipient_id: input.recipient_id,
      text: input.text,
      encrypted_payload,
      status: MessageStatus.CREATED,
      transport: "local",
      created_at,
      expires_at,
      ttl: DEFAULT_TTL_MS,
      hop_count: 0,
    };
    record = this.withStatus(record, MessageStatus.ENCRYPTED);
    record = this.withStatus(record, MessageStatus.QUEUED);
    await this.store.saveMessage(record);
    await this.store.enqueue(record.message_id, 0, now.getTime());
    return this.flushOne(record, now, true);
  }

  async listMessages(conversationId: string): Promise<StoredMessage[]> {
    return this.store.listMessages(conversationId);
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

  async acceptInbound(message: StoredMessage, now = new Date()): Promise<boolean> {
    if (isExpired(message, now)) return false;
    const opened = await this.openInbound(message);
    const existing = await this.store.getMessage(message.message_id);
    if (existing) {
      const merged = this.advanceToward(
        {
          ...existing,
          text: opened.text ?? existing.text,
          encrypted_payload: opened.encrypted_payload || existing.encrypted_payload,
          transport: message.transport || existing.transport,
        },
        message.status,
      );
      await this.store.saveMessage(merged);
      return false;
    }
    const fresh = await this.store.rememberProcessed(message.message_id, now);
    if (!fresh) return false;
    await this.store.saveMessage(opened);
    return true;
  }

  private async flushOne(message: StoredMessage, now: Date, ignoreBackoff: boolean): Promise<StoredMessage> {
    if (isExpired(message, now)) {
      const expired = this.withStatus(message, MessageStatus.EXPIRED);
      await this.store.saveMessage(expired);
      await this.store.removeOutbound(message.message_id);
      return expired;
    }

    const queued = (await this.store.listOutbound()).find((row) => row.message_id === message.message_id);
    if (!ignoreBackoff && queued && queued.next_retry_at > now.getTime()) {
      return message;
    }

    const envelope = toStoredEnvelope(message);
    const result = await this.manager.send(envelope);
    if (result.ok) {
      let sent = this.advanceToward(message, MessageStatus.SENT);
      sent = { ...sent, transport: result.transport };
      await this.store.saveMessage(sent);
      await this.store.removeOutbound(sent.message_id);
      await this.store.rememberProcessed(sent.message_id, now);
      return sent;
    }

    const attempts = (queued?.attempts ?? 0) + 1;
    const wait = nextBackoffMs(attempts, this.retry);
    if (wait === null) {
      const failed = this.withStatus(message, MessageStatus.FAILED);
      await this.store.saveMessage(failed);
      await this.store.removeOutbound(message.message_id);
      return failed;
    }
    const queuedAgain = { ...this.withStatus(message, MessageStatus.QUEUED), transport: "local" };
    await this.store.saveMessage(queuedAgain);
    await this.store.enqueue(message.message_id, attempts, now.getTime() + wait);
    return queuedAgain;
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
      const stored: StoredMessage = {
        message_id,
        conversation_id: String(row.conversation_id ?? conversationId),
        sender_id: String(row.sender_id ?? ""),
        recipient_id: String(row.recipient_id ?? ""),
        text: typeof row.text === "string" ? row.text : null,
        encrypted_payload: String(row.encrypted_payload ?? ""),
        status: String(row.status ?? MessageStatus.DELIVERED),
        transport: String(row.transport ?? "internet"),
        created_at: String(row.created_at ?? new Date().toISOString()),
        expires_at: String(row.expires_at ?? new Date().toISOString()),
        ttl: Number(row.ttl ?? DEFAULT_TTL_MS),
        hop_count: Number(row.hop_count ?? 0),
      };
      await this.acceptInbound(stored);
    }
  }

  private async openInbound(message: StoredMessage): Promise<StoredMessage> {
    if (!isCryptoBoxPayload(message.encrypted_payload) || !this.crypto) {
      return { ...message, text: message.text ?? null };
    }
    try {
      const plain = await this.crypto.decrypt(message.encrypted_payload, undefined, message.message_id, {
        expectedSenderId: message.sender_id,
        expectedRecipientId: message.recipient_id,
      });
      return { ...message, text: plain.text };
    } catch {
      return { ...message, text: message.text ?? null };
    }
  }

  private advanceToward(message: StoredMessage, target: string): StoredMessage {
    if (message.status === target) return message;
    const steps: string[] = [];
    if (target === MessageStatus.SENT || target === MessageStatus.DELIVERED || target === MessageStatus.READ) {
      if (message.status === MessageStatus.QUEUED) steps.push(MessageStatus.SENDING);
      if (message.status === MessageStatus.QUEUED || message.status === MessageStatus.SENDING) {
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
