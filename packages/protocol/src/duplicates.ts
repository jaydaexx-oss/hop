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
   * @returns false if this ID was already processed (caller must discard).
   */
  remember(messageId: string): boolean {
    if (this.ids.has(messageId)) {
      return false;
    }
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
