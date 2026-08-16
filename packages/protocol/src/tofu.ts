/**
 * Trust-on-first-use binding of a user id to a libsodium public key.
 * First-contact spoofing is still possible until a key is bound.
 * KEY_CHANGED is never auto-trusted and does not overwrite the stored fingerprint.
 */

export type PeerTrustState = "UNKNOWN" | "TOFU_TRUSTED" | "VERIFIED" | "KEY_CHANGED";

export interface PeerTrustRecord {
  userId: string;
  publicKey: string;
  state: Exclude<PeerTrustState, "UNKNOWN">;
  pendingPublicKey?: string;
}

export interface PeerTrustPersistence {
  loadAll(): Promise<PeerTrustRecord[]>;
  save(record: PeerTrustRecord): Promise<void>;
}

export class PublicKeyTofu {
  private readonly records = new Map<string, PeerTrustRecord>();
  private persist?: PeerTrustPersistence;

  constructor(persist?: PeerTrustPersistence) {
    this.persist = persist;
  }

  setPersistence(persist: PeerTrustPersistence | undefined): void {
    this.persist = persist;
  }

  async hydrate(): Promise<void> {
    if (!this.persist) return;
    const rows = await this.persist.loadAll();
    for (const row of rows) this.records.set(row.userId, row);
  }

  state(userId: string): PeerTrustState {
    return this.records.get(userId)?.state ?? "UNKNOWN";
  }

  /** Previously trusted fingerprint. For KEY_CHANGED this is the original key, not the new one. */
  get(userId: string): string | undefined {
    return this.records.get(userId)?.publicKey;
  }

  requireTrustedPublicKey(userId: string): string {
    const rec = this.records.get(userId);
    if (!rec) {
      throw new Error("Peer identity is not trusted");
    }
    if (rec.state === "KEY_CHANGED") {
      throw new Error("Peer identity key changed; re-verify before sending");
    }
    return rec.publicKey;
  }

  /**
   * Observe a claimed public key.
   * First seen → TOFU_TRUSTED (persisted).
   * Same key → stay TOFU_TRUSTED or VERIFIED.
   * Different key → KEY_CHANGED; do not overwrite the stored fingerprint; do not auto-trust.
   */
  observe(userId: string, publicKey: string): PeerTrustState {
    if (!userId || !publicKey) return "UNKNOWN";
    const existing = this.records.get(userId);
    if (!existing) {
      const rec: PeerTrustRecord = { userId, publicKey, state: "TOFU_TRUSTED" };
      this.records.set(userId, rec);
      this.queueSave(rec);
      return "TOFU_TRUSTED";
    }
    if (existing.publicKey === publicKey) return existing.state;
    if (existing.state === "KEY_CHANGED" && existing.pendingPublicKey === publicKey) {
      return "KEY_CHANGED";
    }
    const rec: PeerTrustRecord = {
      userId: existing.userId,
      publicKey: existing.publicKey,
      state: "KEY_CHANGED",
      pendingPublicKey: publicKey,
    };
    this.records.set(userId, rec);
    this.queueSave(rec);
    return "KEY_CHANGED";
  }

  /** True only for TOFU_TRUSTED / VERIFIED. KEY_CHANGED returns false and is persisted. */
  bind(userId: string, publicKey: string): boolean {
    const next = this.observe(userId, publicKey);
    return next === "TOFU_TRUSTED" || next === "VERIFIED";
  }

  canEncryptTo(userId: string, publicKey?: string): boolean {
    if (publicKey) {
      const next = this.observe(userId, publicKey);
      return next === "TOFU_TRUSTED" || next === "VERIFIED";
    }
    const rec = this.records.get(userId);
    return Boolean(rec && rec.state !== "KEY_CHANGED");
  }

  /** Reserved for a later QR / safety-number UX. Not auto-called. */
  markVerified(userId: string): boolean {
    const rec = this.records.get(userId);
    if (!rec || rec.state === "KEY_CHANGED") return false;
    const next: PeerTrustRecord = { ...rec, state: "VERIFIED" };
    this.records.set(userId, next);
    this.queueSave(next);
    return true;
  }

  /** Explicit user action only. Never call this from decrypt/encrypt auto-paths. */
  acceptChangedKey(userId: string, publicKey: string): void {
    if (!userId || !publicKey) return;
    const rec: PeerTrustRecord = { userId, publicKey, state: "TOFU_TRUSTED" };
    this.records.set(userId, rec);
    this.queueSave(rec);
  }

  snapshot(): PeerTrustRecord[] {
    return [...this.records.values()];
  }

  private queueSave(record: PeerTrustRecord): void {
    if (!this.persist) return;
    void this.persist.save(record);
  }
}

export function sqlitePeerTrustPersistence(store: {
  listPeerIdentities(): Promise<PeerTrustRecord[]>;
  savePeerIdentity(record: PeerTrustRecord): Promise<void>;
}): PeerTrustPersistence {
  return {
    loadAll: () => store.listPeerIdentities(),
    save: (record) => store.savePeerIdentity(record),
  };
}
