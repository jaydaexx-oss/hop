import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  decryptApplicationMessage,
  encryptApplicationMessage,
  generateIdentityKeyPair,
  MAX_OUTBOX_MESSAGES,
  MessageStatus,
  canonicalLifecycle,
  type IdentityKeyPair,
  type MessageCrypto,
} from "../src/index.js";
import type { HopHttpClient } from "../src/http.js";
import { InternetTransport } from "../src/internetTransport.js";
import { MessageService } from "../src/messageService.js";
import { DEFAULT_RETRY_POLICY } from "../src/retry.js";
import { SqlJsDriver } from "../src/sqlJsDriver.js";
import { HopSqliteStore, type StoredMessage } from "../src/store.js";
import { type EncryptedEnvelope, type SendResult, type Transport } from "../src/transport.js";
import { TransportManager } from "../src/transportManager.js";

const CONVO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CONVO_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SENDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECIPIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function testCrypto(sender: IdentityKeyPair, recipientPk: string): MessageCrypto {
  return {
    encrypt(plain) {
      return encryptApplicationMessage(plain, recipientPk, sender);
    },
    sealLocal(plain) {
      return encryptApplicationMessage(plain, sender.publicKey, sender);
    },
    decrypt(payload, expectedSenderPk, expectedMessageId, options) {
      return decryptApplicationMessage(payload, sender, expectedSenderPk, expectedMessageId, options);
    },
  };
}

function mockHttp() {
  let online = true;
  let postThrows = false;
  const posts: string[] = [];
  const server = new Map<string, Record<string, unknown>>();
  const http: HopHttpClient = {
    async request(path, init) {
      if (path === "/health") {
        return online
          ? { ok: true, status: 200, data: { status: "ok" } }
          : { ok: false, status: 0, data: null };
      }
      if (!online || postThrows) throw new Error("network down");
      if (init?.method === "POST" && path.endsWith("/messages")) {
        const body = init.body as { message_id: string; encrypted_payload: string };
        posts.push(body.message_id);
        const existing = server.get(body.message_id);
        if (existing) return { ok: true, status: 200, data: existing };
        const row = {
          message_id: body.message_id,
          conversation_id: CONVO,
          sender_id: SENDER,
          recipient_id: RECIPIENT,
          encrypted_payload: body.encrypted_payload,
          status: "SENT",
          transport: "internet",
        };
        server.set(body.message_id, row);
        return { ok: true, status: 200, data: row };
      }
      if (path.endsWith("/messages")) return { ok: true, status: 200, data: [...server.values()] };
      return { ok: false, status: 404, data: null };
    },
  };
  return {
    http,
    posts,
    server,
    setOnline(value: boolean) {
      online = value;
    },
    setPostThrows(value: boolean) {
      postThrows = value;
    },
  };
}

function bleTransport(sent: EncryptedEnvelope[], options?: { fail?: boolean; dropAfter?: number }): Transport {
  return {
    id: "bluetooth",
    async isAvailable() {
      return true;
    },
    async canSend() {
      return true;
    },
    async send(envelope): Promise<SendResult> {
      if (options?.fail) return { ok: false, transport: "bluetooth", error: "bluetooth disappeared" };
      if (options?.dropAfter != null && sent.length >= options.dropAfter) {
        return { ok: false, transport: "bluetooth", error: "bluetooth disappeared" };
      }
      sent.push(envelope);
      return { ok: true, transport: "bluetooth" };
    },
    subscribe() {
      return () => undefined;
    },
    status() {
      return { id: "bluetooth", available: true, implemented: true, detail: "mock" };
    },
  };
}

const tmpDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hop-delivery-"));
  tmpDirs.push(dir);
  return path.join(dir, "hop.db");
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

async function openService(file: string, http: HopHttpClient, crypto: MessageCrypto, extra?: Transport) {
  const driver = await SqlJsDriver.open(file);
  const store = new HopSqliteStore(driver);
  await store.init();
  const manager = new TransportManager();
  manager.register(new InternetTransport(http));
  if (extra) manager.register(extra);
  const service = new MessageService(store, manager, http, () => "token", crypto);
  return { driver, store, service, manager };
}

async function inboundBox(
  alice: IdentityKeyPair,
  blake: IdentityKeyPair,
  overrides: Partial<{
    message_id: string;
    sender_id: string;
    recipient_id: string;
    conversation_id: string;
    text: string;
    created_at: string;
    send_seq: number;
  }> = {},
): Promise<StoredMessage> {
  const message_id = overrides.message_id ?? "11111111-1111-4111-8111-111111111111";
  const created_at = overrides.created_at ?? "2026-08-16T00:00:01.000Z";
  const packed = await encryptApplicationMessage(
    {
      message_id,
      sender_id: overrides.sender_id ?? RECIPIENT,
      recipient_id: overrides.recipient_id ?? SENDER,
      conversation_id: overrides.conversation_id ?? CONVO,
      text: overrides.text ?? "hello",
      created_at,
      expires_at: "2026-08-23T00:00:01.000Z",
      ttl: 86_400_000,
      hop_count: 0,
      send_seq: overrides.send_seq,
    },
    alice.publicKey,
    blake,
  );
  return {
    message_id,
    conversation_id: overrides.conversation_id ?? CONVO,
    sender_id: overrides.sender_id ?? RECIPIENT,
    recipient_id: overrides.recipient_id ?? SENDER,
    text: null,
    encrypted_payload: packed,
    status: MessageStatus.SENT,
    transport: "internet",
    created_at,
    expires_at: "2026-08-23T00:00:01.000Z",
    ttl: 86_400_000,
    hop_count: 0,
    send_seq: overrides.send_seq,
  };
}

const sendInput = { conversation_id: CONVO, sender_id: SENDER, recipient_id: RECIPIENT };

describe("offline-first delivery hardening", () => {
  it("drops a duplicate envelope at the protocol boundary", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const inbound = await inboundBox(alice, blake);
    expect(await session.service.acceptInbound(inbound)).toBe(true);
    expect(await session.service.acceptInbound({ ...inbound, transport: "bluetooth" })).toBe(false);
    expect(await session.service.listMessages(CONVO)).toHaveLength(1);
    session.driver.close();
  });

  it("does not deliver the same logical message twice over BLE and Internet", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const inbound = await inboundBox(alice, blake, { message_id: "22222222-2222-4222-8222-222222222222" });
    const viaBle = { ...inbound, transport: "bluetooth" };
    const viaNet = { ...inbound, transport: "internet" };
    const first = await session.service.acceptInbound(viaBle);
    const second = await session.service.acceptInbound(viaNet);
    expect(Number(first) + Number(second)).toBe(1);
    expect(await session.service.listMessages(CONVO)).toHaveLength(1);
    session.driver.close();
  });

  it("queues when Internet disappears during send", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    world.setPostThrows(true);
    const queued = await session.service.sendText({ ...sendInput, text: "offline" });
    expect(queued.status).toBe(MessageStatus.QUEUED);
    const listed = await session.service.listMessages(CONVO);
    expect(canonicalLifecycle(listed[0]!.status, listed[0]!.retry_attempts ?? 0)).toBe("retrying");
    expect(await session.store.queuedCount()).toBe(1);
    const raw = await session.store.getMessage(queued.message_id);
    expect(raw?.text).toBeNull();
    expect(JSON.stringify(await session.store.listOutbound())).not.toContain("offline");
    session.driver.close();
  });

  it("queues when Bluetooth disappears during send and Internet is down", async () => {
    const world = mockHttp();
    world.setOnline(false);
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const bleSent: EncryptedEnvelope[] = [];
    const session = await openService(
      tempDb(),
      world.http,
      testCrypto(alice, blake.publicKey),
      bleTransport(bleSent, { fail: true }),
    );
    const queued = await session.service.sendText({ ...sendInput, text: "ble-drop" });
    expect(queued.status).toBe(MessageStatus.QUEUED);
    expect(bleSent).toHaveLength(0);
    expect(await session.store.queuedCount()).toBe(1);
    session.driver.close();
  });

  it("sends a queued message exactly once after app restart", async () => {
    const file = tempDb();
    const world = mockHttp();
    world.setOnline(false);
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const crypto = testCrypto(alice, blake.publicKey);
    const first = await openService(file, world.http, crypto);
    const queued = await first.service.sendText({ ...sendInput, text: "persist-me" });
    const sending = await first.store.getMessage(queued.message_id);
    expect(sending).toBeTruthy();
    await first.store.saveMessage({ ...sending!, status: MessageStatus.SENDING });
    first.driver.close();

    const second = await openService(file, world.http, crypto);
    expect(await second.store.queuedCount()).toBe(1);
    world.setOnline(true);
    await second.service.sync();
    expect((await second.store.getMessage(queued.message_id))?.status).toBe(MessageStatus.SENT);
    expect(world.posts.filter((id) => id === queued.message_id)).toHaveLength(1);
    second.driver.close();
  });

  it("queues 100 messages then flushes each logical id once", { timeout: 60_000 }, async () => {
    const world = mockHttp();
    world.setOnline(false);
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const sent = await session.service.sendText({ ...sendInput, text: `m-${i}` });
      ids.push(sent.message_id);
      expect(sent.status).toBe(MessageStatus.QUEUED);
    }
    expect(new Set(ids).size).toBe(100);
    expect(await session.store.queuedCount()).toBe(100);
    world.setOnline(true);
    await session.service.sync();
    expect(await session.store.queuedCount()).toBe(0);
    expect(world.posts).toEqual(ids);
    session.driver.close();
  });

  it("stores out-of-order packets in send_seq / id order", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const later = await inboundBox(alice, blake, {
      message_id: "33333333-3333-4333-8333-333333333333",
      created_at: "2026-08-16T00:00:02.000Z",
      send_seq: 2,
      text: "two",
    });
    const earlier = await inboundBox(alice, blake, {
      message_id: "22222222-2222-4222-8222-222222222222",
      created_at: "2026-08-16T00:00:09.000Z",
      send_seq: 1,
      text: "one",
    });
    expect(await session.service.acceptInbound(later)).toBe(true);
    expect(await session.service.acceptInbound(earlier)).toBe(true);
    const listed = await session.service.listMessages(CONVO);
    expect(listed.map((row) => row.text)).toEqual(["one", "two"]);
    session.driver.close();
  });

  it("applies a delayed acknowledgement without marking queued as delivered", async () => {
    const world = mockHttp();
    world.setOnline(false);
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const queued = await session.service.sendText({ ...sendInput, text: "wait-for-ack" });
    expect(queued.status).toBe(MessageStatus.QUEUED);
    expect(await session.service.applyDeliveryAck(queued.message_id)).toBe(false);
    world.setOnline(true);
    await session.service.sync();
    expect((await session.store.getMessage(queued.message_id))?.status).toBe(MessageStatus.SENT);
    expect(await session.service.applyDeliveryAck(queued.message_id)).toBe(true);
    expect((await session.store.getMessage(queued.message_id))?.status).toBe(MessageStatus.DELIVERED);
    session.driver.close();
  });

  it("ignores a duplicate acknowledgement", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const sent = await session.service.sendText({ ...sendInput, text: "ack-twice" });
    expect(await session.service.applyDeliveryAck(sent.message_id)).toBe(true);
    expect(await session.service.applyDeliveryAck(sent.message_id)).toBe(true);
    expect(await session.service.applyValidatedDeliveryAck({
      kind: "delivery_ack",
      ack_of: sent.message_id,
      ack_status: "READ",
      sender_id: RECIPIENT,
      recipient_id: SENDER,
      conversation_id: CONVO,
    })).toBe(true);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.READ);
    expect(await session.service.listMessages(CONVO)).toHaveLength(1);
    session.driver.close();
  });

  it("rejects malformed ciphertext", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const inbound = await inboundBox(alice, blake, { message_id: "44444444-4444-4444-8444-444444444444" });
    const parsed = JSON.parse(inbound.encrypted_payload) as { ciphertext: string };
    parsed.ciphertext = `${parsed.ciphertext.slice(0, -6)}XXXXXX`;
    expect(
      await session.service.acceptInbound({ ...inbound, encrypted_payload: JSON.stringify(parsed) }),
    ).toBe(false);
    expect(await session.store.listMessages(CONVO)).toHaveLength(0);
    session.driver.close();
  });

  it("rejects an unknown sender injecting into a known conversation", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const eve = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    await session.store.saveConversation({
      id: CONVO,
      peer_id: RECIPIENT,
      peer_username: "blake",
      peer_public_key: blake.publicKey,
      created_at: new Date().toISOString(),
    });
    const packed = await encryptApplicationMessage(
      {
        message_id: "55555555-5555-4555-8555-555555555555",
        sender_id: EVE,
        recipient_id: SENDER,
        conversation_id: CONVO,
        text: "injected",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        ttl: 86_400_000,
        hop_count: 0,
      },
      alice.publicKey,
      eve,
    );
    expect(
      await session.service.acceptInbound({
        message_id: "55555555-5555-4555-8555-555555555555",
        conversation_id: CONVO,
        sender_id: EVE,
        recipient_id: SENDER,
        text: null,
        encrypted_payload: packed,
        status: MessageStatus.SENT,
        transport: "internet",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        ttl: 86_400_000,
        hop_count: 0,
      }),
    ).toBe(false);
    expect(await session.store.listMessages(CONVO)).toHaveLength(0);
    session.driver.close();
  });

  it("survives rapid connect/disconnect without duplicate posts", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    world.setOnline(false);
    const queued = await session.service.sendText({ ...sendInput, text: "flap" });
    for (let i = 0; i < 12; i++) {
      world.setOnline(i % 2 === 0);
      await session.service.sync();
    }
    world.setOnline(true);
    await session.service.sync();
    expect((await session.store.getMessage(queued.message_id))?.status).toBe(MessageStatus.SENT);
    expect(world.posts.filter((id) => id === queued.message_id)).toHaveLength(1);
    session.driver.close();
  });

  it("marks FAILED after retry exhaustion and Retry sends once", async () => {
    const world = mockHttp();
    world.setOnline(false);
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const now = new Date("2026-08-16T00:00:00.000Z");
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const sent = await session.service.sendText({ ...sendInput, text: "exhaust", now });
    let cursor = now.getTime();
    for (let i = 0; i < DEFAULT_RETRY_POLICY.maxAttempts + 2; i++) {
      cursor += 10 * 60_000;
      await session.service.retryDue(new Date(cursor));
    }
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.FAILED);
    expect(await session.store.queuedCount()).toBe(0);
    world.setOnline(true);
    const retried = await session.service.retryFailed(sent.message_id, new Date(cursor + 1_000));
    expect(retried?.status).toBe(MessageStatus.SENT);
    expect(world.posts.filter((id) => id === sent.message_id)).toHaveLength(1);
    session.driver.close();
  });

  it("preserves per-conversation order when two conversations send concurrently", async () => {
    const world = mockHttp();
    world.setOnline(false);
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const [a1, b1, a2, b2] = await Promise.all([
      session.service.sendText({ ...sendInput, text: "a1" }),
      session.service.sendText({
        conversation_id: CONVO_B,
        sender_id: SENDER,
        recipient_id: RECIPIENT,
        text: "b1",
      }),
      session.service.sendText({ ...sendInput, text: "a2" }),
      session.service.sendText({
        conversation_id: CONVO_B,
        sender_id: SENDER,
        recipient_id: RECIPIENT,
        text: "b2",
      }),
    ]);
    world.setOnline(true);
    const order: string[] = [];
    const original = world.http.request.bind(world.http);
    world.http.request = async (path, init) => {
      if (init?.method === "POST" && path.endsWith("/messages")) {
        order.push((init.body as { message_id: string }).message_id);
      }
      return original(path, init);
    };
    await session.service.sync();
    const convoA = order.filter((id) => id === a1.message_id || id === a2.message_id);
    const convoB = order.filter((id) => id === b1.message_id || id === b2.message_id);
    expect(convoA).toEqual([a1.message_id, a2.message_id]);
    expect(convoB).toEqual([b1.message_id, b2.message_id]);
    session.driver.close();
  });

  it("refuses to grow the outbox past the cap", async () => {
    const world = mockHttp();
    world.setOnline(false);
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    for (let i = 0; i < MAX_OUTBOX_MESSAGES; i++) {
      const sent = await session.service.sendText({ ...sendInput, text: `cap-${i}` });
      expect(sent.status).toBe(MessageStatus.QUEUED);
    }
    const overflow = await session.service.sendText({ ...sendInput, text: "overflow" });
    expect(overflow.status).toBe(MessageStatus.FAILED);
    expect(await session.store.queuedCount()).toBe(MAX_OUTBOX_MESSAGES);
    session.driver.close();
  }, 120_000);

  it("message ids are UUIDs and do not embed user ids", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const sent = await session.service.sendText({ ...sendInput, text: "id-check" });
    expect(sent.message_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(sent.message_id.includes(SENDER)).toBe(false);
    expect(sent.message_id.includes(RECIPIENT)).toBe(false);
    session.driver.close();
  });
});
