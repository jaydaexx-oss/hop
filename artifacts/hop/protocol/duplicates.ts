// Ported from packages/protocol/src/duplicates.ts (jaydaexx-oss/hop)
// No bugs in this file — faithfully reproduced.
//
// Bounded LRU set: once it exceeds maxIds entries the oldest id is evicted so
// memory stays flat regardless of how long the app runs.

const DEFAULT_MAX_IDS = 50_000;

export class ProcessedIdSet {
  private readonly ids = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly maxIds = DEFAULT_MAX_IDS) {}

  has(messageId: string): boolean {
    return this.ids.has(messageId);
  }

  /**
   * Records a message ID.
   * @returns false if this ID was already seen (caller must discard).
   */
  remember(messageId: string): boolean {
    if (this.ids.has(messageId)) return false;
    this.ids.add(messageId);
    this.order.push(messageId);
    if (this.order.length > this.maxIds) {
      const oldest = this.order.shift();
      if (oldest) this.ids.delete(oldest);
    }
    return true;
  }

  get size(): number {
    return this.ids.size;
  }
}
