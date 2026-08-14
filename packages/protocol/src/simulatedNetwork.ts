import { sendWithAckRetry, type AckAttempt } from "./ackRetry.js";
import {
  decryptApplicationMessage,
  encryptApplicationMessage,
  generateIdentityKeyPair,
  type IdentityKeyPair,
} from "./cryptoBox.js";
import { ProcessedIdSet } from "./duplicates.js";
import { createMessageId } from "./ids.js";
import { DEFAULT_TTL_MS } from "./message.js";
import { decideRelay, visitedPath, type RelayDropReason } from "./relayPolicy.js";
import type { EncryptedEnvelope, SendResult } from "./transport.js";

export type SimEvent =
  | { type: "sent"; from: string; to: string; message_id: string }
  | { type: "relay"; node: string; nextHop: string; message_id: string }
  | { type: "delivered"; node: string; message_id: string }
  | { type: "ack"; node: string; message_id: string }
  | { type: "e2e_ack"; node: string; of: string }
  | { type: "drop"; node: string; reason: RelayDropReason | "missing_node" | "no_link"; message_id: string }
  | { type: "retry"; from: string; to: string; message_id: string };

export interface SimulatedNode {
  id: string;
  keys: IdentityKeyPair;
  consent: boolean;
  inbox: Array<{ message_id: string; text: string; sender_id: string }>;
  deliveryAcks: Set<string>;
  seen: ProcessedIdSet;
}

function linkKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const HOP_RETRY = { baseMs: 1, maxMs: 1, maxAttempts: 3 };

export class SimulatedNetwork {
  readonly events: SimEvent[] = [];
  private readonly nodes = new Map<string, SimulatedNode>();
  private readonly links = new Set<string>();
  private readonly dropNext = new Set<string>();
  private now = new Date();

  setNow(now: Date): void {
    this.now = now;
  }

  async addNode(id: string, consent = true): Promise<SimulatedNode> {
    const node: SimulatedNode = {
      id,
      keys: await generateIdentityKeyPair(),
      consent,
      inbox: [],
      deliveryAcks: new Set(),
      seen: new ProcessedIdSet(),
    };
    this.nodes.set(id, node);
    return node;
  }

  node(id: string): SimulatedNode {
    const found = this.nodes.get(id);
    if (!found) throw new Error(`Unknown node ${id}`);
    return found;
  }

  connect(a: string, b: string): void {
    this.links.add(linkKey(a, b));
  }

  disconnect(a: string, b: string): void {
    this.links.delete(linkKey(a, b));
  }

  /** Device disappearance: node and all of its links vanish. */
  removeNode(id: string): void {
    this.nodes.delete(id);
    for (const key of [...this.links]) {
      if (key.split("|").includes(id)) this.links.delete(key);
    }
  }

  /** Next packet on this link is dropped (broken route / loss). */
  dropNextPacket(a: string, b: string): void {
    this.dropNext.add(linkKey(a, b));
  }

  neighbors(id: string): string[] {
    const out: string[] = [];
    for (const key of this.links) {
      const [left, right] = key.split("|");
      if (left === id && this.nodes.has(right)) out.push(right);
      if (right === id && this.nodes.has(left)) out.push(left);
    }
    return out.sort();
  }

  publicKey(id: string): string {
    return this.node(id).keys.publicKey;
  }

  async sendText(
    from: string,
    to: string,
    text: string,
    options: { ttlMs?: number } = {},
  ): Promise<SendResult & { envelope: EncryptedEnvelope }> {
    const envelope = await this.craftEnvelope(from, to, text, options);
    const result = await this.sendHop(from, envelope);
    return { ...result, envelope };
  }

  async craftEnvelope(
    from: string,
    to: string,
    text: string,
    options: { ttlMs?: number; kind?: "message" | "delivery_ack"; ackOf?: string } = {},
  ): Promise<EncryptedEnvelope> {
    const sender = this.node(from);
    const created = this.now;
    const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
    const messageId = createMessageId();
    const conversationId = `sim:${[from, to].sort().join(":")}`;
    const expires = new Date(created.getTime() + ttl).toISOString();
    return {
      message_id: messageId,
      sender_id: from,
      recipient_id: to,
      conversation_id: conversationId,
      encrypted_payload: await encryptApplicationMessage(
        {
          message_id: messageId,
          sender_id: from,
          recipient_id: to,
          conversation_id: conversationId,
          text,
          created_at: created.toISOString(),
          expires_at: expires,
          ttl,
          hop_count: 0,
          kind: options.kind ?? "message",
          ack_of: options.ackOf,
        },
        this.publicKey(to),
        sender.keys,
      ),
      created_at: created.toISOString(),
      expires_at: expires,
      ttl,
      hop_count: 0,
      transport: "relay",
      path: [from],
    };
  }

  /** Replay an existing envelope (duplicate / inject). */
  inject(to: string, from: string, envelope: EncryptedEnvelope): Promise<boolean> {
    return this.handleInbound(to, from, envelope);
  }

  private async sendHop(from: string, envelope: EncryptedEnvelope): Promise<SendResult> {
    const next = this.chooseOriginHop(from, envelope);
    if (!next) {
      this.events.push({ type: "drop", node: from, reason: "broken_route", message_id: envelope.message_id });
      return { ok: false, transport: "relay", error: "No next hop" };
    }
    return sendWithAckRetry(
      async (): Promise<AckAttempt> => {
        this.events.push({ type: "retry", from, to: next, message_id: envelope.message_id });
        const acked = await this.transmit(from, next, envelope);
        return acked ? "acked" : "no-ack";
      },
      { retry: HOP_RETRY, sleep: async () => undefined, timeoutError: "Delivery ack timed out" },
    ).then((result) => {
      if (result.ok) {
        this.events.push({ type: "sent", from, to: next, message_id: envelope.message_id });
        return { ok: true, transport: "relay" as const };
      }
      return { ok: false, transport: "relay" as const, error: result.error };
    });
  }

  private chooseOriginHop(from: string, envelope: EncryptedEnvelope): string | null {
    const neighbors = this.neighbors(from);
    if (neighbors.includes(envelope.recipient_id)) return envelope.recipient_id;
    return neighbors.find((id) => !visitedPath(envelope).includes(id)) ?? neighbors[0] ?? null;
  }

  private async transmit(from: string, to: string, envelope: EncryptedEnvelope): Promise<boolean> {
    if (!this.nodes.has(to) || !this.nodes.has(from)) {
      this.events.push({ type: "drop", node: from, reason: "missing_node", message_id: envelope.message_id });
      return false;
    }
    const key = linkKey(from, to);
    if (!this.links.has(key)) {
      this.events.push({ type: "drop", node: from, reason: "no_link", message_id: envelope.message_id });
      return false;
    }
    if (this.dropNext.has(key)) {
      this.dropNext.delete(key);
      this.events.push({ type: "drop", node: to, reason: "no_link", message_id: envelope.message_id });
      return false;
    }
    return this.handleInbound(to, from, envelope);
  }

  private async handleInbound(selfId: string, fromId: string, envelope: EncryptedEnvelope): Promise<boolean> {
    const node = this.nodes.get(selfId);
    if (!node) return false;
    const decision = decideRelay({
      selfId,
      envelope,
      neighbors: this.neighbors(selfId),
      consent: node.consent,
      duplicate: node.seen.has(envelope.message_id),
      now: this.now,
    });

    if (decision.action === "drop") {
      this.events.push({ type: "drop", node: selfId, reason: decision.reason, message_id: envelope.message_id });
      return false;
    }
    if (decision.action === "ack_duplicate") {
      this.events.push({ type: "ack", node: selfId, message_id: envelope.message_id });
      return true;
    }
    if (decision.action === "deliver") {
      try {
        const plain = await decryptApplicationMessage(
          envelope.encrypted_payload,
          node.keys,
          undefined,
          envelope.message_id,
        );
        node.seen.remember(envelope.message_id);
        this.events.push({ type: "ack", node: selfId, message_id: envelope.message_id });
        if (plain.kind === "delivery_ack" && plain.ack_of) {
          node.deliveryAcks.add(plain.ack_of);
          this.events.push({ type: "e2e_ack", node: selfId, of: plain.ack_of });
          return true;
        }
        node.inbox.push({ message_id: plain.message_id, text: plain.text, sender_id: plain.sender_id });
        this.events.push({ type: "delivered", node: selfId, message_id: plain.message_id });
        await this.sendDeliveryAck(node, envelope, plain.message_id);
        return true;
      } catch {
        this.events.push({ type: "drop", node: selfId, reason: "unauthenticated", message_id: envelope.message_id });
        return false;
      }
    }

    this.events.push({
      type: "relay",
      node: selfId,
      nextHop: decision.nextHop,
      message_id: envelope.message_id,
    });
    const hopResult = await sendWithAckRetry(
      async (): Promise<AckAttempt> => {
        const acked = await this.transmit(selfId, decision.nextHop, decision.envelope);
        return acked ? "acked" : "no-ack";
      },
      { retry: HOP_RETRY, sleep: async () => undefined, timeoutError: "Delivery ack timed out" },
    );
    const forwarded = hopResult.ok;
    if (forwarded) {
      node.seen.remember(envelope.message_id);
      this.events.push({ type: "ack", node: selfId, message_id: envelope.message_id });
    }
    return forwarded;
  }

  private async sendDeliveryAck(
    dest: SimulatedNode,
    original: EncryptedEnvelope,
    ofMessageId: string,
  ): Promise<void> {
    const ackId = createMessageId();
    const ack: EncryptedEnvelope = {
      message_id: ackId,
      sender_id: dest.id,
      recipient_id: original.sender_id,
      conversation_id: original.conversation_id,
      encrypted_payload: await encryptApplicationMessage(
        {
          message_id: ackId,
          sender_id: dest.id,
          recipient_id: original.sender_id,
          conversation_id: original.conversation_id,
          text: "ACK",
          created_at: this.now.toISOString(),
          expires_at: original.expires_at,
          ttl: original.ttl,
          hop_count: 0,
          kind: "delivery_ack",
          ack_of: ofMessageId,
        },
        this.publicKey(original.sender_id),
        dest.keys,
      ),
      created_at: this.now.toISOString(),
      expires_at: original.expires_at,
      ttl: original.ttl,
      hop_count: 0,
      transport: "relay",
      path: [dest.id],
    };
    await this.sendHop(dest.id, ack);
  }
}
