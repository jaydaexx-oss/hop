/**
 * Trust-on-first-use binding of a user id to a libsodium public key.
 * First-contact spoofing is still possible until a key is bound.
 */
export class PublicKeyTofu {
  private readonly keys = new Map<string, string>();

  bind(userId: string, publicKey: string): boolean {
    if (!userId || !publicKey) return false;
    const existing = this.keys.get(userId);
    if (existing && existing !== publicKey) return false;
    this.keys.set(userId, publicKey);
    return true;
  }

  get(userId: string): string | undefined {
    return this.keys.get(userId);
  }
}
