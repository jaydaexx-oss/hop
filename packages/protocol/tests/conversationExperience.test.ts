import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CHAT_PAGE_SIZE,
  MessageStatus,
  applyOptimisticSendFailure,
  decryptApplicationMessage,
  encryptApplicationMessage,
  generateIdentityKeyPair,
  mergeChatWindow,
  sameLogicalIdentity,
  type IdentityKeyPair,
  type MessageCrypto,
} from "../src/index.js";
import type { HopHttpClient } from "../src/http.js";
import { InternetTransport } from "../src/internetTransport.js";
import { MessageService } from "../src/messageService.js";
import { SqlJsDriver } from "../src/sqlJsDriver.js";
import { HopSqliteStore, type StoredMessage } from "../src/store.js";
import { PublicKeyTofu } from "../src/tofu.js";
import { type EncryptedEnvelope, type SendResult, type Transport, type TransportId } from "../src/transport.js";
import { TransportManager } from "../src/transportManager.js";

const CONVO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONVO_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ALICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function testCrypto(self: IdentityKeyPair, peerPk: string, tofu?: PublicKeyTofu): MessageCrypto {
  return {
    encrypt(plain) {
      return encryptApplicationMessage(plain, peerPk, self);
    },
    sealLocal(plain) {
      return encryptApplicationMessage(plain, self.publicKey, self);
    },
    decrypt(payload, expectedSenderPk, expectedMessageId, options) {
      return decryptApplicationMessage(payload, self, expectedSenderPk, expectedMessageId, {
        ...options,
        tofu: options?.tofu ?? tofu,
      });
    },
  };
}

function mockHttp(online = true) {
  let up = online;
  const posts: EncryptedEnvelope[] = [];
  const server = new Map<string, Record<string, unknown>>();
  const http: HopHttpClient = {
    async request(path, init) {
      if (path === "/health") {
        return up ? { ok: true, status: 200, data: { status: "ok" } } : { ok: false, status: 0, data: null };
      }
      if (!up) throw new Error("network down");
      if (init?.method === "POST" && path.endsWith("/messages")) {
        const body = init.body as EncryptedEnvelope;
        posts.push(body);
        const existing = server.get(body.message_id);
        if (existing) return { ok: true, status: 200, data: existing };
        const row = { ...body, status: "SENT", text: "server-plaintext-must-be-ignored" };
        server.set(body.message_id, row);
        return { ok: true, status: 200, data: row };
      }
      if (path.includes("/conversations/") && path.endsWith("/messages")) {
        const conversationId = path.split("/")[2];
        return {
          ok: true,
          status: 200,
          data: [...server.values()].filter((row) => row.conversation_id === conversationId),
        };
      }
      return { ok: false, status: 404, data: null };
    },
  };
  return {
    http,
    posts,
    server,
    setOnline(value: boolean) {
      up = value;
    },
  };
}

function mockTransport(id: TransportId, sent: EncryptedEnvelope[], available: () => boolean): Transport {
  return {
    id,
    async isAvailable() {
      return available();
    },
    async canSend() {
      return available();
    },
    async send(envelope): Promise<SendResult> {
      if (!available()) return { ok: false, transport: id, error: "unavailable" };
      sent.push(envelope);
      return { ok: true, transport: id };
    },
    subscribe() {
      return () => undefined;
    },
    status() {
      return { id, available: available(), implemented: true, detail: "mock" };
    },
  };
}

const tmpDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hop-ux-"));
  tmpDirs.push(dir);
  return path.join(dir, "hop.db");
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

async function openPeer(options: {
  file: string;
  self: IdentityKeyPair;
  peer: IdentityKeyPair;
  selfId: string;
  peerId: string;
  conversationId?: string;
  http?: HopHttpClient;
  extra?: Transport;
  crypto?: MessageCrypto;
}) {
  const conversationId = options.conversationId ?? CONVO;
  const world = options.http ? { http: options.http } : mockHttp(true);
  const driver = await SqlJsDriver.open(options.file);
  const store = new HopSqliteStore(driver);
  await store.init();
  await store.saveConversation({
    id: conversationId,
    peer_id: options.peerId,
    peer_username: "peer",
    peer_public_key: options.peer.publicKey,
    created_at: new Date().toISOString(),
  });
  const manager = new TransportManager();
  manager.register(new InternetTransport(world.http));
  if (options.extra) manager.register(options.extra);
  const tofu = new PublicKeyTofu();
  tofu.observe(options.peerId, options.peer.publicKey);
  const service = new MessageService(
    store,
    manager,
    world.http,
    () => "token",
    options.crypto ?? testCrypto(options.self, options.peer.publicKey, tofu),
    tofu,
  );
  await store.setSyncValue("self_user_id", options.selfId);
  return { driver, store, service, manager };
}

async function inboundMessage(
  to: IdentityKeyPair,
  from: IdentityKeyPair,
  fields: {
    message_id: string;
    sender_id: string;
    recipient_id: string;
    conversation_id?: string;
    text?: string;
    send_seq?: number;
    created_at?: string;
    transport?: string;
  },
): Promise<StoredMessage> {
  const created_at = fields.created_at ?? "2026-08-16T00:00:01.000Z";
  const packed = await encryptApplicationMessage(
    {
      message_id: fields.message_id,
      sender_id: fields.sender_id,
      recipient_id: fields.recipient_id,
      conversation_id: fields.conversation_id ?? CONVO,
      text: fields.text ?? "hello",
      created_at,
      expires_at: "2026-08-23T00:00:01.000Z",
      ttl: 86_400_000,
      hop_count: 0,
      send_seq: fields.send_seq,
    },
    to.publicKey,
    from,
  );
  return {
    message_id: fields.message_id,
    conversation_id: fields.conversation_id ?? CONVO,
    sender_id: fields.sender_id,
    recipient_id: fields.recipient_id,
    text: null,
    encrypted_payload: packed,
    status: MessageStatus.SENT,
    transport: fields.transport ?? "internet",
    created_at,
    expires_at: "2026-08-23T00:00:01.000Z",
    ttl: 86_400_000,
    hop_count: 0,
    send_seq: fields.send_seq,
  };
}

describe("production conversation experience", () => {
  it("optimistic send uses the canonical MessageService id and does not create a second identity", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(true);
    const session = await openPeer({
      file: tempDb(),
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
    });
    const seen: string[] = [];
    const sent = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "hello",
      onAllocated: (row) => {
        seen.push(row.message_id);
        expect(row.message_id).toMatch(/^[0-9a-f-]{36}$/i);
        expect(row.status).toBe(MessageStatus.ENCRYPTING);
      },
    });
    expect(seen).toEqual([sent.message_id]);
    const listed = await session.service.listMessages(CONVO);
    expect(listed.map((row) => row.message_id)).toEqual([sent.message_id]);
    expect(world.posts[0]?.message_id).toBe(sent.message_id);
    session.driver.close();
  });

  it("queues offline sends under the same id and recovers without duplicating", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(false);
    const file = tempDb();
    const session = await openPeer({
      file,
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
    });
    const queued = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "offline",
    });
    expect(queued.status).toBe(MessageStatus.QUEUED);
    expect(await session.store.queuedCount()).toBe(1);
    session.driver.close();

    world.setOnline(true);
    const restored = await openPeer({
      file,
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
    });
    await restored.service.sync();
    const listed = await restored.service.listMessages(CONVO);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.message_id).toBe(queued.message_id);
    expect(listed[0]?.status).toBe(MessageStatus.SENT);
    restored.driver.close();
  });

  it("marks encrypt failure FAILED on the allocated id and retries without cloning", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(true);
    let failEncrypt = true;
    const base = testCrypto(alice, bob.publicKey);
    const crypto: MessageCrypto = {
      ...base,
      async encrypt(plain) {
        if (failEncrypt) throw new Error("box failed");
        return base.encrypt(plain);
      },
    };
    const session = await openPeer({
      file: tempDb(),
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
      crypto,
    });
    let allocated = "";
    await expect(
      session.service.sendText({
        conversation_id: CONVO,
        sender_id: ALICE_ID,
        recipient_id: BOB_ID,
        text: "secret",
        onAllocated: (row) => {
          allocated = row.message_id;
        },
      }),
    ).rejects.toThrow(/box failed/i);
    expect(allocated).toBeTruthy();
    const failed = await session.store.getMessage(allocated);
    expect(failed?.status).toBe(MessageStatus.FAILED);
    expect(failed?.text).toBeNull();
    expect(JSON.stringify(failed)).not.toContain("secret");
    expect(world.posts).toHaveLength(0);

    failEncrypt = false;
    const retried = await session.service.retryFailed(allocated);
    expect(retried?.message_id).toBe(allocated);
    expect(retried?.status).toBe(MessageStatus.SENT);
    expect(world.posts.map((item) => item.message_id)).toEqual([allocated]);
    const listed = await session.service.listMessages(CONVO);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.message_id).toBe(allocated);
    session.driver.close();
  });

  it("does not persist plaintext when both encrypt and local seal fail", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(true);
    const session = await openPeer({
      file: tempDb(),
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
      crypto: {
        async encrypt() {
          throw new Error("box failed");
        },
        async sealLocal() {
          throw new Error("box failed");
        },
        async decrypt() {
          throw new Error("box failed");
        },
      },
    });
    await expect(
      session.service.sendText({
        conversation_id: CONVO,
        sender_id: ALICE_ID,
        recipient_id: BOB_ID,
        text: "plaintext-must-not-land",
      }),
    ).rejects.toThrow(/box failed/i);
    expect(await session.store.listMessages(CONVO)).toHaveLength(0);
    expect(await session.store.queuedCount()).toBe(0);
    session.driver.close();
  });

  it("paginates without regressing receipts or altering identity", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(true);
    const session = await openPeer({
      file: tempDb(),
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
    });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const sent = await session.service.sendText({
        conversation_id: CONVO,
        sender_id: ALICE_ID,
        recipient_id: BOB_ID,
        text: `m-${i}`,
      });
      ids.push(sent.message_id);
    }
    const latest = await session.service.listMessagesPage(CONVO, { limit: 2 });
    expect(latest.rows).toHaveLength(2);
    expect(latest.hasOlder).toBe(true);
    expect(latest.rows.map((row) => row.message_id)).toEqual(ids.slice(3));
    const older = await session.service.listMessagesPage(CONVO, {
      beforeMessageId: latest.rows[0]?.message_id,
      limit: 2,
    });
    expect(older.rows.map((row) => row.message_id)).toEqual(ids.slice(1, 3));
    const merged = mergeChatWindow(latest.rows, older.rows);
    expect(merged.map((row) => row.message_id)).toEqual(ids.slice(1));
    expect(CHAT_PAGE_SIZE).toBe(50);
    session.driver.close();
  });

  it("counts unread from DELIVERED inbound and does not treat background as READ", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const bobSession = await openPeer({
      file: tempDb(),
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: mockHttp(true).http,
    });
    const inbound = await inboundMessage(bob, alice, {
      message_id: "11111111-1111-4111-8111-111111111111",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      send_seq: 1,
      text: "hi",
    });
    expect(await bobSession.service.acceptInbound({ ...inbound, status: MessageStatus.DELIVERED })).toBe(true);
    expect(await bobSession.service.unreadCounts(BOB_ID)).toEqual({ [CONVO]: 1 });
    expect(await bobSession.service.unreadCount(CONVO, BOB_ID)).toBe(1);
    const listed = await bobSession.service.listMessages(CONVO);
    expect(listed[0]?.status).toBe(MessageStatus.DELIVERED);
    await bobSession.service.markConversationRead(CONVO, BOB_ID);
    expect(await bobSession.service.unreadCounts(BOB_ID)).toEqual({});
    expect((await bobSession.service.listMessages(CONVO))[0]?.status).toBe(MessageStatus.READ);
    bobSession.driver.close();
  });

  it("orders inbox by last chat activity and ignores delayed ACKs on an older thread", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(true);
    const session = await openPeer({
      file: tempDb(),
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
    });
    await session.store.saveConversation({
      id: CONVO_B,
      peer_id: BOB_ID,
      peer_username: "peer-b",
      peer_public_key: bob.publicKey,
      created_at: "2026-08-01T00:00:00.000Z",
    });
    const older = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "older-thread",
      now: new Date("2026-08-16T00:00:00.000Z"),
    });
    await session.service.sendText({
      conversation_id: CONVO_B,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "newer-thread",
      now: new Date("2026-08-16T00:10:00.000Z"),
    });
    const before = await session.service.listInbox(ALICE_ID);
    expect(before.map((row) => row.id)).toEqual([CONVO_B, CONVO]);
    await session.store.saveMessage({
      ...(await session.store.getMessage(older.message_id))!,
      status: MessageStatus.READ,
    });
    const afterAck = await session.service.listInbox(ALICE_ID);
    expect(afterAck.map((row) => row.id)).toEqual([CONVO_B, CONVO]);
    session.driver.close();
  });

  it("collapses BLE and HTTPS copies of one inbound message", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const session = await openPeer({
      file: tempDb(),
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: mockHttp(true).http,
    });
    const packed = await inboundMessage(bob, alice, {
      message_id: "22222222-2222-4222-8222-222222222222",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      send_seq: 1,
      text: "once",
    });
    const ble = { ...packed, transport: "bluetooth" };
    const https = { ...packed, transport: "internet", created_at: "2026-08-16T00:00:09.000Z" };
    expect(sameLogicalIdentity(ble, https)).toBe(true);
    expect(await session.service.acceptInbound(ble)).toBe(true);
    expect(await session.service.acceptInbound(https)).toBe(false);
    expect(await session.service.listMessages(CONVO)).toHaveLength(1);
    session.driver.close();
  });

  it("does not duplicate a bubble when BLE and internet both accept the same outbound", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(true);
    const bleSent: EncryptedEnvelope[] = [];
    let bleUp = true;
    const session = await openPeer({
      file: tempDb(),
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
      extra: mockTransport("bluetooth", bleSent, () => bleUp),
    });
    const sent = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "hybrid",
    });
    bleUp = false;
    await session.service.sync();
    const listed = await session.service.listMessages(CONVO);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.message_id).toBe(sent.message_id);
    session.driver.close();
  });

  it("does not paint FAILED after a successful send when a later load/sync fails", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(true);
    const session = await openPeer({
      file: tempDb(),
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
    });
    let allocated = "";
    const sent = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "keep-sent",
      onAllocated: (row) => {
        allocated = row.message_id;
      },
    });
    expect(sent.status).toBe(MessageStatus.SENT);
    expect(allocated).toBe(sent.message_id);
    const overlay = applyOptimisticSendFailure(
      mergeChatWindow([{ ...sent, status: MessageStatus.ENCRYPTING }], [sent]),
      allocated,
    );
    expect(overlay).toHaveLength(1);
    expect(overlay[0]?.message_id).toBe(sent.message_id);
    expect(overlay[0]?.status).toBe(MessageStatus.SENT);
    expect(world.posts.map((item) => item.message_id)).toEqual([sent.message_id]);
    session.driver.close();
  });

  it("does not mark inbound READ from listing, pagination, or an unfocused reload", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const bobSession = await openPeer({
      file: tempDb(),
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: mockHttp(true).http,
    });
    const inbound = await inboundMessage(bob, alice, {
      message_id: "33333333-3333-4333-8333-333333333333",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      send_seq: 1,
      text: "unread",
    });
    expect(await bobSession.service.acceptInbound({ ...inbound, status: MessageStatus.DELIVERED })).toBe(true);
    expect((await bobSession.service.listMessages(CONVO))[0]?.status).toBe(MessageStatus.DELIVERED);
    expect((await bobSession.service.listMessagesPage(CONVO, { limit: 50 })).rows[0]?.status).toBe(
      MessageStatus.DELIVERED,
    );
    expect(await bobSession.service.unreadCount(CONVO, BOB_ID)).toBe(1);
    bobSession.driver.close();
  });

  it("HTTP 200 is SENT, never DELIVERED, and a READ ACK from SENT does not regress", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(true);
    const session = await openPeer({
      file: tempDb(),
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
    });
    const sent = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "ack-me",
    });
    expect(sent.status).toBe(MessageStatus.SENT);
    expect(world.server.get(sent.message_id)?.status).toBe("SENT");
    expect(
      await session.service.applyValidatedDeliveryAck({
        kind: "delivery_ack",
        ack_of: sent.message_id,
        ack_status: "READ",
        ack_type: "READ_ACK",
        ack_v: 1,
        sender_id: BOB_ID,
        recipient_id: ALICE_ID,
        conversation_id: CONVO,
        message_id: "44444444-4444-4444-8444-444444444444",
        text: "",
      }),
    ).toBe(true);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.READ);
    expect(
      await session.service.applyValidatedDeliveryAck({
        kind: "delivery_ack",
        ack_of: sent.message_id,
        ack_status: "DELIVERED",
        ack_type: "DELIVERED_ACK",
        ack_v: 1,
        sender_id: BOB_ID,
        recipient_id: ALICE_ID,
        conversation_id: CONVO,
        message_id: "55555555-5555-4555-8555-555555555555",
        text: "",
      }),
    ).toBe(true);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.READ);
    session.driver.close();
  });
});
