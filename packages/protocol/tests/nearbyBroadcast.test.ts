import { describe, expect, it } from "vitest";

import { decodeEnvelope, encodeEnvelope } from "../src/bleCodec.js";
import {
  NEARBY_BROADCAST_TTL_MS,
  NEARBY_BROADCAST_TYPE,
  NearbyBroadcastFeed,
  adoptServerBroadcast,
  createNearbyBroadcast,
  decodeNearbyBroadcastFrame,
  encodeNearbyBroadcastFrame,
  formatBroadcastTime,
  isOwnBroadcast,
  mergeBroadcastFeed,
  nearbyBroadcastFanoutTargets,
  nearbyBroadcastFeedHasSecrets,
  parseBroadcastTimestamp,
  parseNearbyBroadcastWire,
  planBroadcastReply,
  pruneExpiredBroadcasts,
  viewBroadcastCreatesConversation,
} from "../src/nearbyBroadcast.js";

const NOW = new Date("2026-08-21T22:00:00.000Z");

function post(overrides: Partial<Parameters<typeof createNearbyBroadcast>[0]> = {}) {
  return createNearbyBroadcast({
    authorId: "author-1",
    displayName: "maya",
    body: "Coffee on the patio",
    now: NOW,
    ...overrides,
  });
}

describe("nearby broadcast protocol", () => {
  it("posts appear in the feed with a you indicator for the author", () => {
    const feed = new NearbyBroadcastFeed(() => "author-1");
    const created = feed.post({ authorId: "author-1", displayName: "maya", body: "Hello nearby" });
    expect(feed.list()).toEqual([created]);
    expect(isOwnBroadcast(created, "author-1")).toBe(true);
    expect(isOwnBroadcast(created, "other")).toBe(false);
  });

  it("reply opens a private chat, not another public post", () => {
    const created = post({ authorId: "blake", displayName: "blake" });
    const plan = planBroadcastReply(created, { selfId: "maya", blockedIds: [] });
    expect(plan).toEqual({
      action: "open_private_chat",
      authorId: "blake",
      displayName: "blake",
      broadcastId: created.id,
      createsConversation: true,
      publicPost: false,
    });
    expect(viewBroadcastCreatesConversation()).toBe(false);
    expect(planBroadcastReply(created, { selfId: "blake", blockedIds: [] }).action).toBe("none");
  });

  it("viewing the feed does not create a conversation", () => {
    const feed = new NearbyBroadcastFeed(() => "maya");
    feed.ingest(post({ authorId: "blake", displayName: "blake", body: "Anyone here?" }));
    expect(feed.list()).toHaveLength(1);
    expect(viewBroadcastCreatesConversation()).toBe(false);
  });

  it("drops expired posts and honors TTL", () => {
    const live = post({ ttlMs: 60_000 });
    const expired = post({
      id: "00000000-0000-4000-8000-000000000099",
      body: "old",
      now: new Date(NOW.getTime() - 2 * NEARBY_BROADCAST_TTL_MS),
    });
    expect(pruneExpiredBroadcasts([live, expired], NOW.getTime())).toEqual([live]);
    const feed = new NearbyBroadcastFeed(
      () => "maya",
      () => [],
      () => NOW.getTime() + 90_000,
    );
    feed.ingest(live);
    expect(feed.list()).toEqual([]);
  });

  it("hides blocked authors and refuses reply", () => {
    const feed = new NearbyBroadcastFeed(
      () => "maya",
      () => ["blake"],
    );
    expect(feed.ingest(post({ authorId: "blake", displayName: "blake" }))).toBeNull();
    expect(feed.list()).toEqual([]);
    expect(planBroadcastReply(post({ authorId: "blake", displayName: "blake" }), { selfId: "maya", blockedIds: ["blake"] })).toEqual({
      action: "none",
      reason: "blocked",
    });
  });

  it("is a distinct public type, not a crypto_box envelope", () => {
    const created = post();
    const bytes = encodeNearbyBroadcastFrame(created);
    expect(decodeEnvelope(bytes)).toBeNull();
    expect(decodeNearbyBroadcastFrame(bytes)?.type).toBeUndefined();
    expect(decodeNearbyBroadcastFrame(bytes)?.body).toBe("Coffee on the patio");
    expect(parseNearbyBroadcastWire({ v: 1, alg: "crypto_box_xsalsa20poly1305", type: NEARBY_BROADCAST_TYPE })).toBeNull();
    const privateBytes = encodeEnvelope({
      message_id: created.id,
      sender_id: "a",
      recipient_id: "b",
      conversation_id: "c",
      encrypted_payload: '{"v":1,"alg":"crypto_box_xsalsa20poly1305","sender_pk":"x","nonce":"n","ciphertext":"c"}',
      created_at: created.createdAt,
      expires_at: created.expiresAt,
      ttl: created.ttlMs,
      hop_count: 0,
      transport: "bluetooth",
    });
    expect(decodeNearbyBroadcastFrame(privateBytes)).toBeNull();
  });

  it("wire format has no GPS, keys, MAC, or device ids", () => {
    const created = post({ displayName: "maya" });
    expect(nearbyBroadcastFeedHasSecrets(created)).toBe(false);
    expect(JSON.stringify(created)).not.toMatch(/deviceId|publicKey|latitude|mac/i);
    expect(
      parseNearbyBroadcastWire({
        v: 1,
        type: NEARBY_BROADCAST_TYPE,
        id: created.id,
        author_id: created.authorId,
        display_name: "maya",
        body: "hi",
        created_at: created.createdAt,
        expires_at: created.expiresAt,
        ttl_ms: created.ttlMs,
        identity_public_key: "leak",
      }),
    ).toBeNull();
    expect(
      nearbyBroadcastFanoutTargets(
        [
          { userId: "blake", deviceId: "AA:BB:CC:DD:EE:FF", sessionEstablished: true },
          { userId: "maya", deviceId: "self", sessionEstablished: true },
          { userId: "blocked", deviceId: "x", sessionEstablished: true },
          { userId: "far", deviceId: "y", sessionEstablished: false },
        ],
        { selfId: "maya", blockedIds: ["blocked"] },
      ),
    ).toEqual([{ userId: "blake", deviceId: "AA:BB:CC:DD:EE:FF" }]);
  });

  it("formats approximate time like the Replit feed", () => {
    expect(formatBroadcastTime(NOW.toISOString(), NOW.getTime())).toBe("just now");
    expect(formatBroadcastTime(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW.getTime())).toBe("5m ago");
  });

  it("merges local sent posts with received copies and never replaces with an empty fetch", () => {
    const mine = post({ id: "11111111-1111-4111-8111-111111111111", authorId: "maya", displayName: "maya" });
    const peer = post({ id: "22222222-2222-4222-8222-222222222222", authorId: "blake", displayName: "blake" });
    const ctx = { selfId: "maya", blockedIds: [], now: NOW.getTime() };
    expect(mergeBroadcastFeed([mine, peer], [], ctx).map((row) => row.id)).toEqual([mine.id, peer.id]);
    const dup = { ...peer, source: "internet" as const };
    expect(mergeBroadcastFeed([mine, peer], [dup], ctx).map((row) => row.id)).toEqual([mine.id, peer.id]);
    const feed = new NearbyBroadcastFeed(() => "maya", () => [], () => NOW.getTime());
    feed.post({ authorId: "maya", displayName: "maya", body: "Hello nearby", id: mine.id });
    expect(feed.mergeIncoming([]).some((row) => row.authorId === "maya")).toBe(true);
  });

  it("adopts a server id/timestamp in place of the optimistic post", () => {
    const optimistic = post({ id: "44444444-4444-4444-8444-444444444444", authorId: "maya", displayName: "maya" });
    const server = post({
      id: "55555555-5555-4555-8555-555555555555",
      authorId: "maya",
      displayName: "maya",
      now: new Date(NOW.getTime() + 1000),
      source: "internet",
    });
    const next = adoptServerBroadcast([optimistic], optimistic.id, server, {
      selfId: "maya",
      blockedIds: [],
      now: NOW.getTime(),
    });
    expect(next).toHaveLength(1);
    expect(next[0]?.id).toBe(server.id);
    expect(next[0]?.createdAt).toBe(server.createdAt);
  });

  it("treats naive API timestamps as UTC so TTL does not shift by timezone", () => {
    expect(parseBroadcastTimestamp("2026-08-21T22:00:00")).toBe(Date.parse("2026-08-21T22:00:00.000Z"));
    const naive = parseNearbyBroadcastWire(
      {
        v: 1,
        type: NEARBY_BROADCAST_TYPE,
        id: "66666666-6666-4666-8666-666666666666",
        author_id: "maya",
        display_name: "maya",
        body: "hi",
        created_at: "2026-08-21T21:00:00",
        expires_at: "2026-08-21T21:01:00",
        ttl_ms: 60_000,
      },
      "internet",
    );
    expect(naive?.expiresAt).toBe("2026-08-21T21:01:00.000Z");
    expect(pruneExpiredBroadcasts(naive ? [naive] : [], NOW.getTime())).toEqual([]);
  });

  it("rejects a spoofed BLE author that does not match the session", () => {
    const feed = new NearbyBroadcastFeed(() => "maya");
    const spoof = post({ authorId: "attacker", displayName: "blake" });
    expect(feed.ingest(spoof, "blake")).toBeNull();
    expect(feed.list()).toEqual([]);
  });
});
