import { BLE_SESSION_IDLE_MS } from "./bleCodec.js";
import type { PublicKeyTofu } from "./tofu.js";

export const BLE_KEY_CHANGED_REFUSAL = "Peer identity key changed; re-verify before sending";

/**
 * First GATT handshake packet remains TOFU (pk is plaintext for discoverability).
 * After a key is bound, a changed pk must refuse send. Unauthenticated GATT ACKs
 * are rejected separately in bleAck.ts.
 */
export function bleSendRefusal(
  tofu: PublicKeyTofu,
  userId: string | undefined,
  publicKey: string | undefined,
): string | null {
  if (!publicKey) return "Secure session is not established";
  if (userId && !tofu.canEncryptTo(userId, publicKey)) {
    return BLE_KEY_CHANGED_REFUSAL;
  }
  return null;
}

export function bleSessionStale(
  lastActivityAt: number | undefined,
  now = Date.now(),
  idleMs = BLE_SESSION_IDLE_MS,
): boolean {
  if (!lastActivityAt) return true;
  return now - lastActivityAt > idleMs;
}

/** Reject replayed handshake nonces for the same user_id within a TTL window. */
export class HandshakeReplayGuard {
  private readonly seen = new Map<string, number>();

  constructor(private readonly ttlMs = 10 * 60_000) {}

  /**
   * @returns false if this (user_id, nonce) was already observed.
   * Handshakes without a nonce are allowed (legacy v2) and are still TOFU.
   */
  remember(userId: string, nonce: string | undefined, now = Date.now()): boolean {
    this.prune(now);
    if (!nonce) return true;
    const key = `${userId}:${nonce}`;
    const expiry = this.seen.get(key);
    if (expiry && expiry > now) return false;
    this.seen.set(key, now + this.ttlMs);
    return true;
  }

  private prune(now: number): void {
    for (const [key, expiry] of this.seen) {
      if (expiry <= now) this.seen.delete(key);
    }
  }
}
