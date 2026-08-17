import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ACK_PROTOCOL_VERSION,
  decryptApplicationMessage,
  encryptApplicationMessage,
  generateIdentityKeyPair,
  mergePersistedStatus,
  MessageStatus,
  sortConversationMessages,
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
const EVE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

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
  const dir = mkdtempSync(path.join(tmpdir(), "hop-sync-"));
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
  tofu?: PublicKeyTofu;
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
  if (options.tofu) options.tofu.observe(options.peerId, options.peer.publicKey);
  const service = new MessageService(
    store,
    manager,
    world.http,
    () => "token",
    testCrypto(options.self, options.peer.publicKey, options.tofu),
    options.tofu,
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
    created_at: "1999-01-01T00:00:00.000Z",
    expires_at: "2026-08-23T00:00:01.000Z",
    ttl: 86_400_000,
    hop_count: 0,
    send_seq: fields.send_seq,
  };
}

async function inboundAck(
  to: IdentityKeyPair,
  from: IdentityKeyPair,
  fields: {
    ack_id: string;
    ack_of: string;
    ack_status?: "DELIVERED" | "READ";
    sender_id: string;
    recipient_id: string;
    conversation_id?: string;
  },
): Promise<StoredMessage> {
  const packed = await encryptApplicationMessage(
    {
      message_id: fields.ack_id,
      sender_id: fields.sender_id,
      recipient_id: fields.recipient_id,
      conversation_id: fields.conversation_id ?? CONVO,
      text: "",
      created_at: "2026-08-16T00:00:01.000Z",
      expires_at: "2026-08-23T00:00:01.000Z",
      ttl: 86_400_000,
      hop_count: 0,
      kind: "delivery_ack",
      ack_of: fields.ack_of,
      ack_status: fields.ack_status ?? "DELIVERED",
      ack_v: ACK_PROTOCOL_VERSION,
    },
    to.publicKey,
    from,
  );
  return {
    message_id: fields.ack_id,
    conversation_id: fields.conversation_id ?? CONVO,
    sender_id: fields.sender_id,
    recipient_id: fields.recipient_id,
    text: null,
    encrypted_payload: packed,
    status: MessageStatus.SENT,
    transport: "internet",
    created_at: "2026-08-16T00:00:01.000Z",
    expires_at: "2026-08-23T00:00:01.000Z",
    ttl: 86_400_000,
    hop_count: 0,
    kind: "delivery_ack",
  };
}

function ids(rows: StoredMessage[]): string[] {
  return rows.map((row) => row.message_id);
}

describe("conversation synchronization and conflict recovery", () => {
  it("keeps message_id stable across BLE then Internet retry", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const bleSent: EncryptedEnvelope[] = [];
    let bleUp = true;
    const world = mockHttp(false);
    const session = await openPeer({
      file: tempDb(),
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
      extra: mockTransport("bluetooth", bleSent, () => bleUp),
    });
    const queued = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "stable-id",
      now: new Date("2026-08-16T00:00:00.000Z"),
    });
    expect(queued.status).toBe(MessageStatus.SENT);
    expect(bleSent).toHaveLength(1);
    expect(bleSent[0]?.message_id).toBe(queued.message_id);
    bleUp = false;
    world.setOnline(true);
    await session.service.sync();
    expect((await session.store.getMessage(queued.message_id))?.message_id).toBe(queued.message_id);
    expect(await session.store.getMessage(queued.message_id)).toMatchObject({ status: MessageStatus.SENT });
    expect((await session.service.listMessages(CONVO)).map((row) => row.message_id)).toEqual([queued.message_id]);
    session.driver.close();
  });

  it("accepts 1000 offline messages once despite reverse, random, and duplicate BLE+HTTPS", { timeout: 180_000 }, async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(false);
    const session = await openPeer({
      file: tempDb(),
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: world.http,
    });
    const messages: StoredMessage[] = [];
    for (let batch = 0; batch < 10; batch++) {
      const chunk = await Promise.all(
        Array.from({ length: 100 }, (_, j) => {
          const i = batch * 100 + j;
          return inboundMessage(bob, alice, {
            message_id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
            sender_id: ALICE_ID,
            recipient_id: BOB_ID,
            send_seq: i + 1,
            created_at: `2026-08-16T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`,
            text: `n-${i}`,
          });
        }),
      );
      messages.push(...chunk);
      expect(messages).toHaveLength((batch + 1) * 100);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const reversed = [...messages].reverse();
    for (let i = 0; i < reversed.length; i++) {
      const row = reversed[i]!;
      expect(await session.service.acceptInbound({ ...row, transport: "bluetooth" })).toBe(true);
      expect(await session.service.acceptInbound({ ...row, transport: "internet" })).toBe(false);
      if (i % 25 === 0) {
        expect(i).toBeGreaterThanOrEqual(0);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    const shuffled = [...messages].sort((a, b) => a.message_id.localeCompare(b.message_id));
    for (const row of shuffled) {
      expect(await session.service.acceptInbound(row)).toBe(false);
    }
    const listed = await session.service.listMessages(CONVO);
    expect(listed).toHaveLength(1000);
    expect(listed.map((row) => row.send_seq)).toEqual(Array.from({ length: 1000 }, (_, i) => i + 1));
    expect(listed.map((row) => row.text)).toEqual(Array.from({ length: 1000 }, (_, i) => `n-${i}`));
    session.driver.close();
  });

  it("converges both peers after simultaneous offline sends, BLE, then Internet", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const worldA = mockHttp(false);
    const worldB = mockHttp(false);
    const aliceSession = await openPeer({
      file: tempDb(),
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: worldA.http,
    });
    const bobSession = await openPeer({
      file: tempDb(),
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: worldB.http,
    });
    const a1 = await aliceSession.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "a1",
      now: new Date("2026-08-16T00:00:01.000Z"),
    });
    const b1 = await bobSession.service.sendText({
      conversation_id: CONVO,
      sender_id: BOB_ID,
      recipient_id: ALICE_ID,
      text: "b1",
      now: new Date("2026-08-16T00:00:02.000Z"),
    });
    const a2 = await aliceSession.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "a2",
      now: new Date("2026-08-16T00:00:03.000Z"),
    });
    const b2 = await bobSession.service.sendText({
      conversation_id: CONVO,
      sender_id: BOB_ID,
      recipient_id: ALICE_ID,
      text: "b2",
      now: new Date("2026-08-16T00:00:04.000Z"),
    });
    const aliceOut = [a2, a1, a2, a1];
    const bobOut = [b2, b1, b1, b2];
    for (const row of aliceOut) {
      const stored = await aliceSession.store.getMessage(row.message_id);
      await bobSession.service.acceptInbound({
        ...stored!,
        transport: row === a1 ? "bluetooth" : "internet",
        status: MessageStatus.SENT,
      });
    }
    for (const row of bobOut) {
      const stored = await bobSession.store.getMessage(row.message_id);
      await aliceSession.service.acceptInbound({
        ...stored!,
        transport: row === b1 ? "internet" : "bluetooth",
        status: MessageStatus.SENT,
      });
    }
    const expected = [a1.message_id, b1.message_id, a2.message_id, b2.message_id];
    expect(ids(await aliceSession.service.listMessages(CONVO))).toEqual(expected);
    expect(ids(await bobSession.service.listMessages(CONVO))).toEqual(expected);
    expect((await aliceSession.service.listMessages(CONVO)).map((row) => row.text)).toEqual(["a1", "b1", "a2", "b2"]);
    expect((await bobSession.service.listMessages(CONVO)).map((row) => row.text)).toEqual(["a1", "b1", "a2", "b2"]);
    aliceSession.driver.close();
    bobSession.driver.close();
  });

  it("orders same-timestamp and clock-skewed messages identically on both devices", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const session = await openPeer({
      file: tempDb(),
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: mockHttp(false).http,
    });
    const sameTs = "2026-08-16T12:00:00.000Z";
    const left = await inboundMessage(bob, alice, {
      message_id: "21111111-1111-4111-8111-111111111111",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      send_seq: 2,
      created_at: "2026-01-01T00:00:00.000Z",
      text: "seq-2",
    });
    const right = await inboundMessage(bob, alice, {
      message_id: "11111111-1111-4111-8111-111111111111",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      send_seq: 1,
      created_at: "2026-12-01T00:00:00.000Z",
      text: "seq-1",
    });
    const twinA = await inboundMessage(bob, alice, {
      message_id: "31111111-1111-4111-8111-111111111111",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      conversation_id: CONVO,
      send_seq: 3,
      created_at: sameTs,
      text: "same-a",
    });
    expect(await session.service.acceptInbound(left)).toBe(true);
    expect(await session.service.acceptInbound(right)).toBe(true);
    expect(await session.service.acceptInbound(twinA)).toBe(true);
    const listed = await session.service.listMessages(CONVO);
    expect(listed.map((row) => row.text)).toEqual(["seq-1", "seq-2", "same-a"]);
    expect(listed.map((row) => row.created_at)).toEqual([
      "2026-12-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      sameTs,
    ]);
    const resorted = sortConversationMessages([...listed].reverse());
    expect(resorted.map((row) => row.message_id)).toEqual(listed.map((row) => row.message_id));
    session.driver.close();
  });

  it("does not regress READ when a stale DELIVERED ACK arrives, and READ may precede DELIVERED", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const tofu = new PublicKeyTofu();
    const session = await openPeer({
      file: tempDb(),
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      tofu,
    });
    const sent = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "receipt-order",
    });
    expect(
      await session.service.acceptInbound(
        await inboundAck(alice, bob, {
          ack_id: "41111111-1111-4111-8111-111111111111",
          ack_of: sent.message_id,
          ack_status: "READ",
          sender_id: BOB_ID,
          recipient_id: ALICE_ID,
        }),
      ),
    ).toBe(true);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.READ);
    expect(
      await session.service.acceptInbound(
        await inboundAck(alice, bob, {
          ack_id: "41111111-1111-4111-8111-111111111112",
          ack_of: sent.message_id,
          ack_status: "DELIVERED",
          sender_id: BOB_ID,
          recipient_id: ALICE_ID,
        }),
      ),
    ).toBe(true);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.READ);
    expect(mergePersistedStatus(MessageStatus.READ, MessageStatus.DELIVERED)).toBe(MessageStatus.READ);
    session.driver.close();
  });

  it("runs duplicate sync, killed sync, and transport switch without duplicating or regressing", async () => {
    const file = tempDb();
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const bleSent: EncryptedEnvelope[] = [];
    let bleUp = false;
    const world = mockHttp(false);
    const first = await openPeer({
      file,
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
      extra: mockTransport("bluetooth", bleSent, () => bleUp),
    });
    const sent = await first.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "handoff",
    });
    expect(sent.status).toBe(MessageStatus.QUEUED);
    const inflight = await first.store.getMessage(sent.message_id);
    await first.store.saveMessage({ ...inflight!, status: MessageStatus.SENDING });
    expect((await first.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.SENDING);
    first.driver.close();

    bleUp = true;
    world.setOnline(true);
    const second = await openPeer({
      file,
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
      extra: mockTransport("bluetooth", bleSent, () => bleUp),
    });
    bleUp = false;
    await Promise.all([second.service.sync(), second.service.sync(), second.service.sync()]);
    const after = await second.store.getMessage(sent.message_id);
    expect(after?.status).toBe(MessageStatus.SENT);
    expect(after?.message_id).toBe(sent.message_id);
    expect(world.posts.filter((row) => row.message_id === sent.message_id)).toHaveLength(1);
    expect(JSON.stringify(world.posts)).not.toContain("handoff");
    expect(JSON.stringify(world.posts)).not.toContain("server-plaintext-must-be-ignored");
    await second.service.sync();
    expect(await second.service.listMessages(CONVO)).toHaveLength(1);
    second.driver.close();
  });

  it("rejects corrupted envelopes, forged senders, and wrong conversations", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const eve = await generateIdentityKeyPair();
    const tofu = new PublicKeyTofu();
    const session = await openPeer({
      file: tempDb(),
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: mockHttp(false).http,
      tofu,
    });
    await session.store.saveConversation({
      id: CONVO_B,
      peer_id: EVE_ID,
      peer_username: "eve",
      peer_public_key: eve.publicKey,
      created_at: new Date().toISOString(),
    });
    const ok = await inboundMessage(bob, alice, {
      message_id: "51111111-1111-4111-8111-111111111111",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "real",
    });
    const parsed = JSON.parse(ok.encrypted_payload) as { ciphertext: string };
    parsed.ciphertext = `${parsed.ciphertext.slice(0, -8)}XXXXXXXX`;
    expect(await session.service.acceptInbound({ ...ok, encrypted_payload: JSON.stringify(parsed) })).toBe(false);

    const forged = await encryptApplicationMessage(
      {
        message_id: "51111111-1111-4111-8111-111111111112",
        sender_id: ALICE_ID,
        recipient_id: BOB_ID,
        conversation_id: CONVO,
        text: "forged",
        created_at: "2026-08-16T00:00:01.000Z",
        expires_at: "2026-08-23T00:00:01.000Z",
        ttl: 86_400_000,
        hop_count: 0,
        send_seq: 9,
      },
      bob.publicKey,
      eve,
    );
    expect(
      await session.service.acceptInbound({
        ...ok,
        message_id: "51111111-1111-4111-8111-111111111112",
        encrypted_payload: forged,
      }),
    ).toBe(false);

    const wrongConvo = await inboundMessage(bob, alice, {
      message_id: "51111111-1111-4111-8111-111111111113",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      conversation_id: CONVO_B,
      text: "wrong-room",
    });
    expect(await session.service.acceptInbound({ ...wrongConvo, conversation_id: CONVO })).toBe(false);
    expect(await session.service.acceptInbound(wrongConvo)).toBe(false);

    const evePlain = await inboundMessage(bob, eve, {
      message_id: "51111111-1111-4111-8111-111111111114",
      sender_id: EVE_ID,
      recipient_id: BOB_ID,
      text: "injected",
    });
    expect(await session.service.acceptInbound(evePlain)).toBe(false);
    expect(await session.service.listMessages(CONVO)).toHaveLength(0);
    session.driver.close();
  });

  it("syncs two conversations simultaneously without mixing membership or ids", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(false);
    const session = await openPeer({
      file: tempDb(),
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: world.http,
    });
    await session.store.saveConversation({
      id: CONVO_B,
      peer_id: ALICE_ID,
      peer_username: "alice",
      peer_public_key: alice.publicKey,
      created_at: new Date().toISOString(),
    });
    const first = await inboundMessage(bob, alice, {
      message_id: "61111111-1111-4111-8111-111111111111",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      send_seq: 1,
      text: "room-a",
    });
    const second = await inboundMessage(bob, alice, {
      message_id: "61111111-1111-4111-8111-111111111112",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      conversation_id: CONVO_B,
      send_seq: 1,
      text: "room-b",
    });
    expect(await Promise.all([session.service.acceptInbound(first), session.service.acceptInbound(second)])).toEqual([
      true,
      true,
    ]);
    world.setOnline(true);
    await Promise.all([session.service.sync(), session.service.sync()]);
    const listedA = await session.service.listMessages(CONVO);
    const listedB = await session.service.listMessages(CONVO_B);
    expect(listedA.map((row) => row.text)).toEqual(["room-a"]);
    expect(listedB.map((row) => row.text)).toEqual(["room-b"]);
    expect(listedA[0]?.conversation_id).toBe(CONVO);
    expect(listedB[0]?.conversation_id).toBe(CONVO_B);
    expect(listedA[0]?.message_id).not.toBe(listedB[0]?.message_id);
    session.driver.close();
  });

  it("recovers a kill during encryption without reusing send_seq or leaking plaintext", async () => {
    const file = tempDb();
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(false);
    const first = await openPeer({
      file,
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
    });
    const seq = await first.store.nextSendSeq(CONVO, ALICE_ID);
    await first.store.saveMessage({
      message_id: "71111111-1111-4111-8111-111111111111",
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "must-not-persist",
      encrypted_payload: "",
      status: MessageStatus.ENCRYPTING,
      transport: "local",
      created_at: "2026-08-16T00:00:00.000Z",
      expires_at: "2026-08-23T00:00:00.000Z",
      ttl: 86_400_000,
      hop_count: 0,
      send_seq: seq,
      kind: "message",
    });
    first.driver.close();

    const second = await openPeer({
      file,
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
    });
    await second.service.recoverInFlight();
    expect(await second.store.getMessage("71111111-1111-4111-8111-111111111111")).toBeNull();
    const resumed = await second.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "after-crash",
    });
    expect(resumed.send_seq).toBeGreaterThan(seq);
    expect(resumed.message_id).not.toBe("71111111-1111-4111-8111-111111111111");
    const raw = await second.store.getMessage(resumed.message_id);
    expect(raw?.text).toBeNull();
    expect(raw?.encrypted_payload).not.toContain("after-crash");
    second.driver.close();
  });

  it("does not let a colliding message_id rewrite conversation membership or ciphertext", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const session = await openPeer({
      file: tempDb(),
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: mockHttp(false).http,
    });
    const original = await inboundMessage(bob, alice, {
      message_id: "81111111-1111-4111-8111-111111111111",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      send_seq: 1,
      text: "original",
    });
    expect(await session.service.acceptInbound(original)).toBe(true);
    await session.store.saveMessage({
      ...original,
      conversation_id: CONVO_B,
      sender_id: EVE_ID,
      encrypted_payload: `${original.encrypted_payload}-tampered`,
      send_seq: 99,
      status: MessageStatus.SENT,
      text: "leak",
    });
    const stored = await session.store.getMessage(original.message_id);
    expect(stored?.conversation_id).toBe(CONVO);
    expect(stored?.sender_id).toBe(ALICE_ID);
    expect(stored?.send_seq).toBe(1);
    expect(stored?.encrypted_payload).toBe(original.encrypted_payload);
    expect(stored?.text).toBeNull();
    expect(stored?.status).toBe(MessageStatus.DELIVERED);
    session.driver.close();
  });
});
