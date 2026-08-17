import { createMessageId } from "./ids.js";
import {
  inferRelationshipFromHistory,
  parseReportCategory,
  relationshipAfterUnblock,
  type InboxVisibility,
  type LocalReportRecord,
  type PeerRelationship,
  type PeerSafetyRecord,
  type ReportCategory,
  type SafetyDecision,
  type SafetyGate,
  decideInbound,
  decideOutbound,
  decideQrContact,
  inboxVisibilityFor,
  shouldNotifyFor,
} from "./safety.js";
import type { HopSqliteStore } from "./store.js";

export class SafetyService implements SafetyGate {
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: HopSqliteStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  onChange(handler: () => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  private emit(): void {
    for (const handler of this.listeners) handler();
  }

  async get(peerId: string): Promise<PeerSafetyRecord | null> {
    return this.store.getPeerSafety(peerId);
  }

  async list(): Promise<PeerSafetyRecord[]> {
    return this.store.listPeerSafety();
  }

  async blockedPeerIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const row of await this.list()) {
      if (row.relationship === "blocked") ids.add(row.peerId);
    }
    return ids;
  }

  async acceptedPeerIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const row of await this.list()) {
      if (row.relationship === "accepted") ids.add(row.peerId);
    }
    return ids;
  }

  async mutedPeerIds(): Promise<Set<string>> {
    const ids = new Set<string>();
    for (const row of await this.list()) {
      if (row.muted) ids.add(row.peerId);
    }
    return ids;
  }

  async listRequests(): Promise<PeerSafetyRecord[]> {
    return (await this.list()).filter(
      (row) => row.relationship === "incoming_request" || row.relationship === "outgoing_request",
    );
  }

  async isBlocked(peerId: string | null | undefined): Promise<boolean> {
    if (!peerId) return false;
    const row = await this.get(peerId);
    return row?.relationship === "blocked";
  }

  async isMuted(peerId: string | null | undefined): Promise<boolean> {
    if (!peerId) return false;
    const row = await this.get(peerId);
    return Boolean(row?.muted);
  }

  async inboxVisibility(peerId: string | null | undefined): Promise<InboxVisibility> {
    if (!peerId) return "hidden";
    return inboxVisibilityFor(await this.get(peerId));
  }

  async shouldNotify(peerId: string | null | undefined): Promise<boolean> {
    if (!peerId) return false;
    return shouldNotifyFor(await this.get(peerId));
  }

  async decideOutbound(peerId: string): Promise<SafetyDecision> {
    return decideOutbound(await this.get(peerId));
  }

  async decideInbound(peerId: string): Promise<SafetyDecision> {
    return decideInbound(await this.get(peerId));
  }

  async decideQr(peerId: string): Promise<SafetyDecision> {
    return decideQrContact(await this.get(peerId));
  }

  async hydrate(selfId: string): Promise<void> {
    const convos = await this.store.listConversations();
    for (const convo of convos) {
      if (!convo.peer_id) continue;
      const existing = await this.get(convo.peer_id);
      if (existing) continue;
      const messages = (await this.store.listMessages(convo.id)).filter((row) => row.kind !== "delivery_ack");
      const inboundCount = messages.filter((row) => row.sender_id === convo.peer_id).length;
      const outboundCount = messages.filter((row) => row.sender_id === selfId).length;
      const relationship = inferRelationshipFromHistory({ inboundCount, outboundCount });
      if (relationship === "none") continue;
      const intro = messages.find((row) =>
        relationship === "outgoing_request" ? row.sender_id === selfId : row.sender_id === convo.peer_id,
      );
      await this.upsert({
        peerId: convo.peer_id,
        relationship,
        muted: false,
        introMessageId: intro?.message_id ?? null,
        preBlockRelationship: null,
      });
    }
    this.emit();
  }

  async recordOutboundIntro(peerId: string, messageId: string): Promise<void> {
    const current = await this.get(peerId);
    if (current?.relationship === "accepted" || current?.relationship === "blocked") return;
    await this.upsert({
      peerId,
      relationship: "outgoing_request",
      muted: current?.muted ?? false,
      introMessageId: messageId,
      preBlockRelationship: current?.preBlockRelationship ?? null,
    });
    this.emit();
  }

  async recordInboundIntro(peerId: string, messageId: string): Promise<void> {
    const current = await this.get(peerId);
    if (current?.relationship === "accepted" || current?.relationship === "blocked") return;
    await this.upsert({
      peerId,
      relationship: "incoming_request",
      muted: current?.muted ?? false,
      introMessageId: current?.introMessageId ?? messageId,
      preBlockRelationship: current?.preBlockRelationship ?? null,
    });
    this.emit();
  }

  async markAccepted(peerId: string): Promise<void> {
    const current = await this.get(peerId);
    if (current?.relationship === "blocked") return;
    await this.upsert({
      peerId,
      relationship: "accepted",
      muted: current?.muted ?? false,
      introMessageId: current?.introMessageId ?? null,
      preBlockRelationship: null,
    });
    this.emit();
  }

  async decline(peerId: string): Promise<void> {
    const current = await this.get(peerId);
    if (current?.relationship === "blocked") return;
    await this.upsert({
      peerId,
      relationship: "declined",
      muted: current?.muted ?? false,
      introMessageId: current?.introMessageId ?? null,
      preBlockRelationship: current?.preBlockRelationship ?? null,
    });
    this.emit();
  }

  async block(peerId: string): Promise<void> {
    const current = await this.get(peerId);
    const prior =
      current?.relationship && current.relationship !== "blocked"
        ? current.relationship
        : (current?.preBlockRelationship ?? null);
    await this.upsert({
      peerId,
      relationship: "blocked",
      muted: current?.muted ?? false,
      introMessageId: current?.introMessageId ?? null,
      preBlockRelationship: prior,
    });
    this.emit();
  }

  async unblock(peerId: string): Promise<void> {
    const current = await this.get(peerId);
    if (!current || current.relationship !== "blocked") return;
    await this.upsert({
      peerId,
      relationship: relationshipAfterUnblock(current),
      muted: current.muted,
      introMessageId: current.introMessageId,
      preBlockRelationship: null,
    });
    this.emit();
  }

  async setMuted(peerId: string, muted: boolean): Promise<void> {
    const current = await this.get(peerId);
    await this.upsert({
      peerId,
      relationship: current?.relationship ?? "none",
      muted,
      introMessageId: current?.introMessageId ?? null,
      preBlockRelationship: current?.preBlockRelationship ?? null,
    });
    this.emit();
  }

  async report(peerId: string, category: ReportCategory, note?: string | null): Promise<LocalReportRecord> {
    const parsed = parseReportCategory(category);
    if (!parsed) throw new Error("Choose a report category.");
    const cleanNote = note?.trim() ? note.trim().slice(0, 200) : null;
    const row: LocalReportRecord = {
      id: createMessageId(),
      peerId,
      category: parsed,
      note: cleanNote,
      createdAt: this.now().toISOString(),
    };
    await this.store.saveLocalReport(row);
    this.emit();
    return row;
  }

  async listReports(): Promise<LocalReportRecord[]> {
    return this.store.listLocalReports();
  }

  private async upsert(input: {
    peerId: string;
    relationship: PeerRelationship;
    muted: boolean;
    introMessageId: string | null;
    preBlockRelationship: PeerRelationship | null;
  }): Promise<void> {
    await this.store.savePeerSafety({
      peerId: input.peerId,
      relationship: input.relationship,
      muted: input.muted,
      introMessageId: input.introMessageId,
      preBlockRelationship: input.preBlockRelationship,
      updatedAt: this.now().toISOString(),
    });
  }
}
