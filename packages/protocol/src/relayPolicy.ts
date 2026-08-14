import { isCryptoBoxPayload } from "./cryptoBox.js";
import { MAX_HOPS, isExpired, shouldStopForwarding } from "./message.js";
import type { EncryptedEnvelope } from "./transport.js";

export type RelayDropReason =
  | "expired"
  | "max_hops"
  | "loop"
  | "no_consent"
  | "broken_route"
  | "unauthenticated"
  | "empty";

export type RelayDecision =
  | { action: "deliver" }
  | { action: "ack_duplicate" }
  | { action: "relay"; nextHop: string; envelope: EncryptedEnvelope }
  | { action: "drop"; reason: RelayDropReason };

export function visitedPath(envelope: EncryptedEnvelope): string[] {
  if (envelope.path && envelope.path.length > 0) {
    return [...envelope.path];
  }
  return envelope.sender_id ? [envelope.sender_id] : [];
}

export function chooseNextHop(
  selfId: string,
  recipientId: string,
  neighbors: readonly string[],
  path: readonly string[],
): string | null {
  const blocked = new Set(path);
  blocked.add(selfId);
  if (neighbors.includes(recipientId) && !blocked.has(recipientId)) {
    return recipientId;
  }
  const candidates = neighbors.filter((id) => !blocked.has(id)).sort();
  return candidates[0] ?? null;
}

export function forwardedEnvelope(envelope: EncryptedEnvelope, selfId: string): EncryptedEnvelope {
  const path = visitedPath(envelope);
  if (!path.includes(selfId)) path.push(selfId);
  return {
    ...envelope,
    hop_count: envelope.hop_count + 1,
    path,
    transport: "relay",
  };
}

export function decideRelay(input: {
  selfId: string;
  envelope: EncryptedEnvelope;
  neighbors: readonly string[];
  consent: boolean;
  duplicate: boolean;
  now?: Date;
  maxHops?: number;
}): RelayDecision {
  const { selfId, envelope, neighbors, consent, duplicate } = input;
  const now = input.now ?? new Date();
  const maxHops = input.maxHops ?? MAX_HOPS;

  if (!envelope.encrypted_payload) {
    return { action: "drop", reason: "empty" };
  }
  if (!isCryptoBoxPayload(envelope.encrypted_payload)) {
    return { action: "drop", reason: "unauthenticated" };
  }
  if (isExpired(envelope, now)) {
    return { action: "drop", reason: "expired" };
  }
  if (duplicate) {
    return { action: "ack_duplicate" };
  }

  const path = visitedPath(envelope);
  if (path.includes(selfId) && envelope.recipient_id !== selfId) {
    return { action: "drop", reason: "loop" };
  }

  if (envelope.recipient_id === selfId) {
    return { action: "deliver" };
  }

  if (!consent) {
    return { action: "drop", reason: "no_consent" };
  }
  if (shouldStopForwarding(envelope, now, maxHops) || path.length >= maxHops) {
    return { action: "drop", reason: "max_hops" };
  }

  const nextHop = chooseNextHop(selfId, envelope.recipient_id, neighbors, path);
  if (!nextHop) {
    return { action: "drop", reason: "broken_route" };
  }
  return { action: "relay", nextHop, envelope: forwardedEnvelope(envelope, selfId) };
}
