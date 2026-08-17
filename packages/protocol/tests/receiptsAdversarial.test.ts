import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ACK_PROTOCOL_VERSION,
  AckType,
  decryptApplicationMessage,
  encryptApplicationMessage,
  generateIdentityKeyPair,
  MessageStatus,
  parseCryptoBoxPayload,
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
  const http: HopHttpClient = {
    async request(path, init) {
      if (path === "/health") {
        return up ? { ok: true, status: 200, data: { status: "ok" } } : { ok: false, status: 0, data: null };
      }
      if (!up) throw new Error("network down");
      if (init?.method === "POST" && path.endsWith("/messages")) {
        const body = init.body as EncryptedEnvelope;
        posts.push(body);
        return { ok: true, status: 200, data: { ...body, status: "SENT" } };
      }
      if (path.endsWith("/messages")) return { ok: true, status: 200, data: [] };
      return { ok: false, status: 404, data: null };
    },
  };
  return {
    http,
    posts,
    setOnline(value: boolean) {
      up = value;
    },
  };
}

function mockTransport(
  id: TransportId,
  sent: EncryptedEnvelope[],
  available: () => boolean,
): Transport {
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
  const dir = mkdtempSync(path.join(tmpdir(), "hop-receipts-"));
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
  return { driver, store, service, manager, http: world.http };
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
    transport?: string;
  },
): Promise<StoredMessage> {
  const created_at = "2026-08-16T00:00:01.000Z";
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
    text?: string;
    ack_v?: number;
    transport?: string;
  },
): Promise<StoredMessage> {
  const created_at = new Date().toISOString();
  const packed = await encryptApplicationMessage(
    {
      message_id: fields.ack_id,
      sender_id: fields.sender_id,
      recipient_id: fields.recipient_id,
      conversation_id: fields.conversation_id ?? CONVO,
      text: fields.text ?? "",
      created_at,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      ttl: 86_400_000,
      hop_count: 0,
      kind: "delivery_ack",
      ack_of: fields.ack_of,
      ack_status: fields.ack_status ?? "DELIVERED",
      ack_v: fields.ack_v ?? ACK_PROTOCOL_VERSION,
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
    transport: fields.transport ?? "internet",
    created_at,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    ttl: 86_400_000,
    hop_count: 0,
  };
}

describe("encrypted delivery/read receipts", () => {
  it("duplicate DELIVERED_ACK and READ_ACK stay monotonic", async () => {
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
      text: "dup-ack",
    });
    const delivered = await inboundAck(alice, bob, {
      ack_id: "11111111-1111-4111-8111-111111111111",
      ack_of: sent.message_id,
      sender_id: BOB_ID,
      recipient_id: ALICE_ID,
    });
    expect(await session.service.acceptInbound(delivered)).toBe(true);
    expect(await session.service.acceptInbound(delivered)).toBe(false);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.DELIVERED);
    const read = await inboundAck(alice, bob, {
      ack_id: "22222222-2222-4222-8222-222222222222",
      ack_of: sent.message_id,
      ack_status: "READ",
      sender_id: BOB_ID,
      recipient_id: ALICE_ID,
    });
    expect(await session.service.acceptInbound(read)).toBe(true);
    expect(await session.service.acceptInbound(read)).toBe(false);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.READ);
    session.driver.close();
  });

  it("READ then delayed DELIVERED_ACK remains READ", async () => {
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
      text: "read-first",
    });
    expect(
      await session.service.acceptInbound(
        await inboundAck(alice, bob, {
          ack_id: "33333333-3333-4333-8333-333333333333",
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
          ack_id: "44444444-4444-4444-8444-444444444444",
          ack_of: sent.message_id,
          ack_status: "DELIVERED",
          sender_id: BOB_ID,
          recipient_id: ALICE_ID,
        }),
      ),
    ).toBe(true);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.READ);
    session.driver.close();
  });

  it("applies an ACK that arrived before the original local row reloads", async () => {
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
    const pendingId = "55555555-5555-4555-8555-555555555555";
    expect(
      await session.service.acceptInbound(
        await inboundAck(alice, bob, {
          ack_id: "66666666-6666-4666-8666-666666666666",
          ack_of: pendingId,
          sender_id: BOB_ID,
          recipient_id: ALICE_ID,
        }),
      ),
    ).toBe(true);
    expect(await session.store.getMessage(pendingId)).toBeNull();
    const packed = await encryptApplicationMessage(
      {
        message_id: pendingId,
        sender_id: ALICE_ID,
        recipient_id: BOB_ID,
        conversation_id: CONVO,
        text: "late local",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        ttl: 86_400_000,
        hop_count: 0,
      },
      bob.publicKey,
      alice,
    );
    await session.store.saveMessage({
      message_id: pendingId,
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: null,
      encrypted_payload: packed,
      status: MessageStatus.SENT,
      transport: "internet",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      ttl: 86_400_000,
      hop_count: 0,
      kind: "message",
    });
    await session.service.recoverInFlight();
    expect((await session.store.getMessage(pendingId))?.status).toBe(MessageStatus.DELIVERED);
    session.driver.close();
  });

  it("rejects forged, unknown-peer, wrong-conversation, and unauthenticated acks", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const eve = await generateIdentityKeyPair();
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
      text: "auth",
    });
    const forged = await inboundAck(alice, eve, {
      ack_id: "77777777-7777-4777-8777-777777777777",
      ack_of: sent.message_id,
      sender_id: BOB_ID,
      recipient_id: ALICE_ID,
    });
    expect(await session.service.acceptInbound(forged)).toBe(false);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.SENT);

    expect(
      await session.service.acceptInbound(
        await inboundAck(alice, bob, {
          ack_id: "88888888-8888-4888-8888-888888888888",
          ack_of: sent.message_id,
          sender_id: BOB_ID,
          recipient_id: ALICE_ID,
          conversation_id: CONVO_B,
        }),
      ),
    ).toBe(false);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.SENT);

    expect(
      await session.service.applyValidatedDeliveryAck({
        kind: "delivery_ack",
        ack_of: sent.message_id,
        ack_status: "READ",
        sender_id: EVE_ID,
        recipient_id: ALICE_ID,
        conversation_id: CONVO,
        message_id: "eve-ack",
        text: "",
      }),
    ).toBe(false);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.SENT);
    session.driver.close();
  });

  it("unknown message_id does not create a chat row and malformed ACK cannot crash", async () => {
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
    const unknown = "99999999-9999-4999-8999-999999999999";
    expect(
      await session.service.acceptInbound(
        await inboundAck(alice, bob, {
          ack_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
          ack_of: unknown,
          sender_id: BOB_ID,
          recipient_id: ALICE_ID,
        }),
      ),
    ).toBe(true);
    expect(await session.store.getMessage(unknown)).toBeNull();
    expect(await session.service.listMessages(CONVO)).toHaveLength(0);

    const garbage: StoredMessage = {
      message_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      conversation_id: CONVO,
      sender_id: BOB_ID,
      recipient_id: ALICE_ID,
      text: null,
      encrypted_payload: "{not-json",
      status: MessageStatus.SENT,
      transport: "internet",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      ttl: 86_400_000,
      hop_count: 0,
    };
    expect(await session.service.acceptInbound(garbage)).toBe(false);
    const boxed = JSON.stringify({
      v: 1,
      alg: "crypto_box_xsalsa20poly1305",
      sender_pk: parseCryptoBoxPayload(
        (
          await inboundAck(alice, bob, {
            ack_id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
            ack_of: unknown,
            sender_id: BOB_ID,
            recipient_id: ALICE_ID,
          })
        ).encrypted_payload,
      )?.sender_pk,
      nonce: "AAAA",
      ciphertext: "BBBB",
    });
    expect(
      await session.service.acceptInbound({
        ...garbage,
        message_id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
        encrypted_payload: boxed,
      }),
    ).toBe(false);
    session.driver.close();
  });

  it("deduplicates the same ACK arriving on BLE and Internet", async () => {
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
      text: "cross-ack",
    });
    const ack = await inboundAck(alice, bob, {
      ack_id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
      ack_of: sent.message_id,
      sender_id: BOB_ID,
      recipient_id: ALICE_ID,
      transport: "bluetooth",
    });
    expect(await session.service.acceptInbound(ack)).toBe(true);
    expect(await session.service.acceptInbound({ ...ack, transport: "internet" })).toBe(false);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.DELIVERED);
    expect(await session.service.listMessages(CONVO)).toHaveLength(1);
    session.driver.close();
  });

  it("queues DELIVERED_ACK while the recipient is offline and flushes later without resending the message", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(false);
    const bobSession = await openPeer({
      file: tempDb(),
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: world.http,
    });
    const inbound = await inboundMessage(bob, alice, {
      message_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
    });
    expect(await bobSession.service.acceptInbound(inbound)).toBe(true);
    expect(await bobSession.store.queuedCount()).toBe(1);
    const queued = (await bobSession.store.listOutbound())[0];
    const ackRow = await bobSession.store.getMessage(queued.message_id);
    expect(ackRow?.kind).toBe("delivery_ack");
    expect(world.posts).toHaveLength(0);
    world.setOnline(true);
    await bobSession.service.sync();
    expect(world.posts).toHaveLength(1);
    expect(world.posts[0]?.message_id).not.toBe(inbound.message_id);
    const opened = await decryptApplicationMessage(world.posts[0]!.encrypted_payload, alice, bob.publicKey);
    expect(opened.kind).toBe("delivery_ack");
    expect(opened.ack_of).toBe(inbound.message_id);
    expect(opened.ack_type).toBe(AckType.DELIVERED_ACK);
    expect(opened.text).toBe("");
    expect(await bobSession.store.getMessage(inbound.message_id)).toBeTruthy();
    bobSession.driver.close();
  });

  it("recovers a pending ACK after a simulated kill before transmission", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(false);
    const file = tempDb();
    const bobSession = await openPeer({
      file,
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: world.http,
    });
    const inbound = await inboundMessage(bob, alice, {
      message_id: "ffffffff-ffff-4fff-8fff-fffffffffff1",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
    });
    expect(await bobSession.service.acceptInbound(inbound)).toBe(true);
    const ackId = (await bobSession.store.listOutbound())[0]?.message_id;
    expect(ackId).toBeTruthy();
    await bobSession.store.removeOutbound(ackId!);
    bobSession.driver.close();

    const reopened = await openPeer({
      file,
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: world.http,
    });
    await reopened.store.setSyncValue("self_user_id", BOB_ID);
    await reopened.service.recoverInFlight();
    expect(await reopened.store.queuedCount()).toBeGreaterThan(0);
    world.setOnline(true);
    await reopened.service.sync();
    expect(world.posts.some((row) => row.message_id !== inbound.message_id)).toBe(true);
    reopened.driver.close();
  });

  it("sends a BLE message ACK over Internet and an Internet message ACK over BLE", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const bleSent: EncryptedEnvelope[] = [];
    let bleUp = false;
    const world = mockHttp(true);
    const bobSession = await openPeer({
      file: tempDb(),
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: world.http,
      extra: mockTransport("bluetooth", bleSent, () => bleUp),
    });
    const bleMessage = await inboundMessage(bob, alice, {
      message_id: "11111111-1111-4111-8111-1111111111a1",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      transport: "bluetooth",
    });
    expect(await bobSession.service.acceptInbound(bleMessage)).toBe(true);
    expect(world.posts).toHaveLength(1);
    const internetAck = await decryptApplicationMessage(world.posts[0]!.encrypted_payload, alice, bob.publicKey);
    expect(internetAck.ack_of).toBe(bleMessage.message_id);

    world.setOnline(false);
    bleUp = true;
    const netMessage = await inboundMessage(bob, alice, {
      message_id: "11111111-1111-4111-8111-1111111111a2",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      transport: "internet",
      send_seq: 2,
    });
    expect(await bobSession.service.acceptInbound(netMessage)).toBe(true);
    expect(bleSent).toHaveLength(1);
    const bleAck = await decryptApplicationMessage(bleSent[0]!.encrypted_payload, alice, bob.publicKey);
    expect(bleAck.ack_of).toBe(netMessage.message_id);
    bobSession.driver.close();
  });

  it("keeps unread counts correct across duplicate, restart, open/close, and two conversations", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(false);
    const file = tempDb();
    const bobSession = await openPeer({
      file,
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: world.http,
    });
    await bobSession.store.saveConversation({
      id: CONVO_B,
      peer_id: ALICE_ID,
      peer_username: "alice",
      peer_public_key: alice.publicKey,
      created_at: new Date().toISOString(),
    });
    const first = await inboundMessage(bob, alice, {
      message_id: "21111111-1111-4111-8111-111111111111",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      send_seq: 1,
    });
    const second = await inboundMessage(bob, alice, {
      message_id: "21111111-1111-4111-8111-111111111112",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      conversation_id: CONVO_B,
      send_seq: 1,
      text: "other",
    });
    expect(await bobSession.service.acceptInbound(first)).toBe(true);
    expect(await bobSession.service.acceptInbound(first)).toBe(false);
    expect(await bobSession.service.acceptInbound(second)).toBe(true);
    expect(await bobSession.service.unreadCount(CONVO, BOB_ID)).toBe(1);
    expect(await bobSession.service.unreadCount(CONVO_B, BOB_ID)).toBe(1);
    for (let i = 0; i < 8; i++) {
      await bobSession.service.markConversationRead(CONVO, BOB_ID);
    }
    expect(await bobSession.service.unreadCount(CONVO, BOB_ID)).toBe(0);
    expect(await bobSession.service.unreadCount(CONVO_B, BOB_ID)).toBe(1);
    bobSession.driver.close();

    const reopened = await openPeer({
      file,
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: world.http,
    });
    expect(await reopened.service.unreadCount(CONVO, BOB_ID)).toBe(0);
    expect(await reopened.service.unreadCount(CONVO_B, BOB_ID)).toBe(1);
    const counts = await reopened.service.unreadCounts(BOB_ID);
    expect(counts[CONVO_B]).toBe(1);
    reopened.driver.close();
  });

  it("queues 100 pending ACKs through the durable outbox without one timer per message", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(false);
    const bobSession = await openPeer({
      file: tempDb(),
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: world.http,
    });
    for (let i = 0; i < 100; i++) {
      const id = `30000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
      expect(
        await bobSession.service.acceptInbound(
          await inboundMessage(bob, alice, {
            message_id: id,
            sender_id: ALICE_ID,
            recipient_id: BOB_ID,
            send_seq: i + 1,
            text: `n-${i}`,
          }),
        ),
      ).toBe(true);
    }
    expect(await bobSession.store.queuedCount()).toBe(100);
    expect(await bobSession.service.unreadCount(CONVO, BOB_ID)).toBe(100);
    world.setOnline(true);
    await bobSession.service.sync();
    expect(world.posts).toHaveLength(100);
    expect(new Set(world.posts.map((row) => row.message_id)).size).toBe(100);
    bobSession.driver.close();
  }, 60_000);

  it("applies a delayed ACK after local retry exhaustion", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const tofu = new PublicKeyTofu();
    const world = mockHttp(false);
    const session = await openPeer({
      file: tempDb(),
      self: alice,
      peer: bob,
      selfId: ALICE_ID,
      peerId: BOB_ID,
      http: world.http,
      tofu,
    });
    const now = new Date("2026-08-16T00:00:00.000Z");
    const sent = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "exhaust-ack",
      now,
    });
    let cursor = now.getTime();
    for (let i = 0; i < 12; i++) {
      cursor += 10 * 60_000;
      await session.service.retryDue(new Date(cursor));
    }
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.FAILED);
    expect(
      await session.service.acceptInbound(
        await inboundAck(alice, bob, {
          ack_id: "41111111-1111-4111-8111-111111111111",
          ack_of: sent.message_id,
          sender_id: BOB_ID,
          recipient_id: ALICE_ID,
        }),
      ),
    ).toBe(true);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.DELIVERED);
    session.driver.close();
  });

  it("message duplicate then ACK duplicate does not duplicate chat or receipts", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const world = mockHttp(false);
    const bobSession = await openPeer({
      file: tempDb(),
      self: bob,
      peer: alice,
      selfId: BOB_ID,
      peerId: ALICE_ID,
      http: world.http,
    });
    const inbound = await inboundMessage(bob, alice, {
      message_id: "51111111-1111-4111-8111-111111111111",
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
    });
    expect(await bobSession.service.acceptInbound(inbound)).toBe(true);
    expect(await bobSession.service.acceptInbound(inbound)).toBe(false);
    expect(await bobSession.service.listMessages(CONVO)).toHaveLength(1);
    expect(await bobSession.store.queuedCount()).toBe(1);
    await bobSession.service.recoverInFlight();
    expect(await bobSession.store.queuedCount()).toBe(1);
    bobSession.driver.close();
  });
});
