import { bytesToUtf8, looksLikeHardwareId, safeNearbyDisplayName, utf8ToBytes } from "./bleCodec.js";
import { HOP_USERNAME_RE } from "./hopQr.js";
import { createMessageId } from "./ids.js";

export const NEARBY_BROADCAST_TYPE = "nearby_broadcast" as const;
export const NEARBY_BROADCAST_MAX_CHARS = 280;
export const NEARBY_BROADCAST_TTL_MS = 24 * 60 * 60 * 1000;
export const NEARBY_BROADCAST_MIN_TTL_MS = 60_000;

export type NearbyBroadcastSource = "local" | "bluetooth" | "internet";

/** Public nearby feed post. Distinct from private crypto_box chat. */
export interface NearbyBroadcast {
  id: string;
  authorId: string;
  displayName: string;
  body: string;
  createdAt: string;
  expiresAt: string;
  ttlMs: number;
  source: NearbyBroadcastSource;
}

export interface NearbyBroadcastWire {
  v: 1;
  type: typeof NEARBY_BROADCAST_TYPE;
  id: string;
  author_id: string;
  display_name: string;
  body: string;
  created_at: string;
  expires_at: string;
  ttl_ms: number;
}

export type BroadcastReplyPlan =
  | { action: "none"; reason: "own_post" | "expired" | "blocked" | "missing_author" }
  | {
      action: "open_private_chat";
      authorId: string;
      displayName: string;
      broadcastId: string;
      /** Explicit reply creates a DM. Viewing the feed never does. */
      createsConversation: true;
      publicPost: false;
    };

const FORBIDDEN_FEED_KEYS = /^(mac|deviceid|device_id|public_key|identity_public_key|pk|sk|secret|phone|gps|lat|lng|latitude|longitude|encrypted_payload|crypto_box|nonce|ciphertext)$/i;

export function clampNearbyBroadcastTtl(ttlMs?: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs === undefined) return NEARBY_BROADCAST_TTL_MS;
  return Math.min(NEARBY_BROADCAST_TTL_MS, Math.max(NEARBY_BROADCAST_MIN_TTL_MS, Math.floor(ttlMs)));
}

export function nearbyBroadcastDisplayName(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (HOP_USERNAME_RE.test(trimmed)) return trimmed;
  return safeNearbyDisplayName(trimmed);
}

export function isOwnBroadcast(post: Pick<NearbyBroadcast, "authorId">, selfId: string | null | undefined): boolean {
  return Boolean(selfId && post.authorId === selfId);
}

export function isNearbyBroadcastExpired(post: Pick<NearbyBroadcast, "expiresAt">, now = Date.now()): boolean {
  const expires = Date.parse(post.expiresAt);
  if (!Number.isFinite(expires)) return true;
  return now >= expires;
}

export function viewBroadcastCreatesConversation(): false {
  return false;
}

export function formatBroadcastTime(createdAt: string, now = Date.now()): string {
  const ts = Date.parse(createdAt);
  if (!Number.isFinite(ts)) return "";
  const diff = Math.max(0, now - ts);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function createNearbyBroadcast(input: {
  authorId: string;
  displayName: string;
  body: string;
  now?: Date;
  ttlMs?: number;
  source?: NearbyBroadcastSource;
  id?: string;
}): NearbyBroadcast {
  const body = input.body.trim().slice(0, NEARBY_BROADCAST_MAX_CHARS);
  if (!body) throw new Error("Broadcast cannot be empty");
  const authorId = input.authorId.trim();
  if (!authorId) throw new Error("Broadcast needs an author");
  const ttlMs = clampNearbyBroadcastTtl(input.ttlMs);
  const now = input.now ?? new Date();
  return {
    id: input.id ?? createMessageId(),
    authorId,
    displayName: nearbyBroadcastDisplayName(input.displayName),
    body,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    ttlMs,
    source: input.source ?? "local",
  };
}

export function toNearbyBroadcastWire(post: NearbyBroadcast): NearbyBroadcastWire {
  return {
    v: 1,
    type: NEARBY_BROADCAST_TYPE,
    id: post.id,
    author_id: post.authorId,
    display_name: post.displayName,
    body: post.body,
    created_at: post.createdAt,
    expires_at: post.expiresAt,
    ttl_ms: post.ttlMs,
  };
}

export function encodeNearbyBroadcastFrame(post: NearbyBroadcast): Uint8Array {
  return utf8ToBytes(JSON.stringify(toNearbyBroadcastWire(post)));
}

function boundedId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return null;
  return trimmed;
}

export function parseNearbyBroadcastWire(data: unknown, source: NearbyBroadcastSource = "bluetooth"): NearbyBroadcast | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (row.v !== 1 || row.type !== NEARBY_BROADCAST_TYPE) return null;
  if ("encrypted_payload" in row || "ciphertext" in row || "alg" in row) return null;
  for (const key of Object.keys(row)) {
    if (FORBIDDEN_FEED_KEYS.test(key)) return null;
  }
  const id = boundedId(row.id);
  const authorId = boundedId(row.author_id);
  const body = typeof row.body === "string" ? row.body.trim().slice(0, NEARBY_BROADCAST_MAX_CHARS) : "";
  const createdAt = typeof row.created_at === "string" ? row.created_at : "";
  const expiresAt = typeof row.expires_at === "string" ? row.expires_at : "";
  const ttlMs = clampNearbyBroadcastTtl(typeof row.ttl_ms === "number" ? row.ttl_ms : undefined);
  if (!id || !authorId || !body || !createdAt || !expiresAt) return null;
  const created = Date.parse(createdAt);
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(created) || !Number.isFinite(expires)) return null;
  return {
    id,
    authorId,
    displayName: nearbyBroadcastDisplayName(String(row.display_name ?? "")),
    body,
    createdAt: new Date(created).toISOString(),
    expiresAt: new Date(expires).toISOString(),
    ttlMs,
    source,
  };
}

export function decodeNearbyBroadcastFrame(bytes: Uint8Array, source: NearbyBroadcastSource = "bluetooth"): NearbyBroadcast | null {
  if (bytes.length === 0 || bytes.length > 8_192) return null;
  try {
    return parseNearbyBroadcastWire(JSON.parse(bytesToUtf8(bytes)), source);
  } catch {
    return null;
  }
}

export function broadcastVisibleInFeed(
  post: NearbyBroadcast,
  input: { selfId: string | null; blockedIds: Iterable<string>; now?: number },
): boolean {
  if (isNearbyBroadcastExpired(post, input.now ?? Date.now())) return false;
  if (post.authorId && input.selfId && post.authorId === input.selfId) return true;
  const blocked = input.blockedIds instanceof Set ? input.blockedIds : new Set(input.blockedIds);
  if (post.authorId && blocked.has(post.authorId)) return false;
  return true;
}

export function mergeBroadcastFeed(
  existing: NearbyBroadcast[],
  incoming: NearbyBroadcast[],
  input: { selfId: string | null; blockedIds: Iterable<string>; now?: number },
): NearbyBroadcast[] {
  const now = input.now ?? Date.now();
  const byId = new Map<string, NearbyBroadcast>();
  for (const post of [...existing, ...incoming]) {
    if (!broadcastVisibleInFeed(post, { ...input, now })) continue;
    if (!byId.has(post.id)) byId.set(post.id, post);
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function pruneExpiredBroadcasts(posts: NearbyBroadcast[], now = Date.now()): NearbyBroadcast[] {
  return posts.filter((post) => !isNearbyBroadcastExpired(post, now));
}

export function planBroadcastReply(
  post: NearbyBroadcast,
  input: { selfId: string | null; blockedIds: Iterable<string>; now?: number },
): BroadcastReplyPlan {
  if (isOwnBroadcast(post, input.selfId)) return { action: "none", reason: "own_post" };
  if (isNearbyBroadcastExpired(post, input.now ?? Date.now())) return { action: "none", reason: "expired" };
  const blocked = input.blockedIds instanceof Set ? input.blockedIds : new Set(input.blockedIds);
  if (blocked.has(post.authorId)) return { action: "none", reason: "blocked" };
  if (!post.authorId) return { action: "none", reason: "missing_author" };
  return {
    action: "open_private_chat",
    authorId: post.authorId,
    displayName: post.displayName,
    broadcastId: post.id,
    createsConversation: true,
    publicPost: false,
  };
}

export function nearbyBroadcastFanoutTargets(
  peers: Array<{ userId?: string; deviceId: string; sessionEstablished?: boolean }>,
  input: { selfId: string | null; blockedIds: Iterable<string> },
): Array<{ userId: string; deviceId: string }> {
  const blocked = input.blockedIds instanceof Set ? input.blockedIds : new Set(input.blockedIds);
  const out: Array<{ userId: string; deviceId: string }> = [];
  const seen = new Set<string>();
  for (const peer of peers) {
    const userId = peer.userId?.trim();
    if (!userId || userId === input.selfId || blocked.has(userId)) continue;
    if (peer.sessionEstablished !== true) continue;
    if (seen.has(userId)) continue;
    seen.add(userId);
    out.push({ userId, deviceId: peer.deviceId });
  }
  return out;
}

export function nearbyBroadcastFeedHasSecrets(post: NearbyBroadcast): boolean {
  const blob = JSON.stringify(toNearbyBroadcastWire(post));
  if (FORBIDDEN_FEED_KEYS.test(blob)) return true;
  if (looksLikeHardwareId(post.displayName)) return true;
  if (looksLikeHardwareId(post.body) && post.body.includes(":")) return true;
  return /deviceId|publicKey|identity_public_key/i.test(blob);
}

export class NearbyBroadcastFeed {
  private posts: NearbyBroadcast[] = [];

  constructor(
    private readonly selfId: () => string | null,
    private readonly blockedIds: () => Iterable<string> = () => [],
    private readonly now: () => number = () => Date.now(),
  ) {}

  list(): NearbyBroadcast[] {
    this.posts = pruneExpiredBroadcasts(
      this.posts.filter((post) => broadcastVisibleInFeed(post, { selfId: this.selfId(), blockedIds: this.blockedIds(), now: this.now() })),
      this.now(),
    );
    return [...this.posts];
  }

  post(input: { authorId: string; displayName: string; body: string; ttlMs?: number; id?: string }): NearbyBroadcast {
    const created = createNearbyBroadcast({ ...input, now: new Date(this.now()), source: "local" });
    this.posts = mergeBroadcastFeed(this.posts, [created], {
      selfId: this.selfId(),
      blockedIds: this.blockedIds(),
      now: this.now(),
    });
    return created;
  }

  ingest(incoming: NearbyBroadcast, claimedAuthorId?: string): NearbyBroadcast | null {
    if (claimedAuthorId && incoming.authorId !== claimedAuthorId) return null;
    const next = mergeBroadcastFeed(this.posts, [{ ...incoming }], {
      selfId: this.selfId(),
      blockedIds: this.blockedIds(),
      now: this.now(),
    });
    const accepted = next.find((row) => row.id === incoming.id) ?? null;
    this.posts = next;
    return accepted;
  }

  replaceAll(posts: NearbyBroadcast[]): NearbyBroadcast[] {
    this.posts = mergeBroadcastFeed([], posts, {
      selfId: this.selfId(),
      blockedIds: this.blockedIds(),
      now: this.now(),
    });
    return this.list();
  }
}
