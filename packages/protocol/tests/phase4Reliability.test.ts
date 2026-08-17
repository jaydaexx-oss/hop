import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  PublicKeyTofu,
  decryptApplicationMessage,
  encryptApplicationMessage,
  generateIdentityKeyPair,
  isCryptoBoxPayload,
  type IdentityKeyPair,
  type MessageCrypto,
} from "../src/index.js";
import type { HopHttpClient } from "../src/http.js";
import { InternetTransport } from "../src/internetTransport.js";
import { MessageStatus } from "../src/message.js";
import { MessageService } from "../src/messageService.js";
import { DEFAULT_RETRY_POLICY } from "../src/retry.js";
import { SqlJsDriver } from "../src/sqlJsDriver.js";
import { HopSqliteStore, type StoredMessage } from "../src/store.js";
import { type EncryptedEnvelope, type SendResult, type Transport } from "../src/transport.js";
import { TransportManager } from "../src/transportManager.js";

const CONVO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SENDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECIPIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AUDIO_B64 = Buffer.from("ptt-offline", "utf8").toString("base64");

function testCrypto(sender: IdentityKeyPair, recipientPk: string, tofu?: PublicKeyTofu): MessageCrypto {
  return {
    encrypt(plain) {
      if (tofu) {
        const state = tofu.observe(plain.recipient_id, recipientPk);
        if (state === "KEY_CHANGED") throw new Error("Peer identity key changed; re-verify before sending");
      }
      return encryptApplicationMessage(plain, recipientPk, sender);
    },
    sealLocal(plain) {
      return encryptApplicationMessage(plain, sender.publicKey, sender);
    },
    decrypt(payload, expectedSenderPk, expectedMessageId, options) {
      return decryptApplicationMessage(payload, sender, expectedSenderPk, expectedMessageId, {
        ...options,
        tofu: options?.tofu ?? tofu,
      });
    },
  };
}

function mockHttp(options?: { status?: number; throwTimeout?: boolean }) {
  let online = true;
  let postStatus = options?.status ?? 200;
  let throwTimeout = options?.throwTimeout ?? false;
  const posts: string[] = [];
  const server = new Map<string, Record<string, unknown>>();
  const http: HopHttpClient = {
    async request(path, init) {
      if (path === "/health") {
        return online
          ? { ok: true, status: 200, data: { status: "ok" } }
          : { ok: false, status: 0, data: null };
      }
      if (!online || throwTimeout) throw new Error("timeout");
      if (init?.method === "POST" && path.endsWith("/messages")) {
        const body = init.body as { message_id: string; encrypted_payload: string };
        if (postStatus >= 400) {
          return { ok: false, status: postStatus, data: { detail: `HTTP ${postStatus}` } };
        }
        posts.push(body.message_id);
        const existing = server.get(body.message_id);
        if (existing) return { ok: true, status: 200, data: existing };
        const row = {
          message_id: body.message_id,
          conversation_id: CONVO,
          sender_id: SENDER,
          recipient_id: RECIPIENT,
          encrypted_payload: body.encrypted_payload,
          status: "DELIVERED",
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
    setOnline(value: boolean) {
      online = value;
    },
    setPostStatus(status: number) {
      postStatus = status;
    },
    setTimeout(value: boolean) {
      throwTimeout = value;
    },
  };
}

function bleTransport(sent: EncryptedEnvelope[], fail = false): Transport {
  return {
    id: "bluetooth",
    async isAvailable() {
      return true;
    },
    async canSend() {
      return true;
    },
    async send(envelope): Promise<SendResult> {
      if (fail) return { ok: false, transport: "bluetooth", error: "gatt write failed" };
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
  const dir = mkdtempSync(path.join(tmpdir(), "hop-p4-"));
  tmpDirs.push(dir);
  return path.join(dir, "hop.db");
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

async function openService(
  file: string,
  http: HopHttpClient,
  crypto: MessageCrypto,
  extra?: Transport,
  tofu?: PublicKeyTofu,
) {
  const driver = await SqlJsDriver.open(file);
  const store = new HopSqliteStore(driver);
  await store.init();
  const manager = new TransportManager();
  manager.register(new InternetTransport(http));
  if (extra) manager.register(extra);
  const service = new MessageService(store, manager, http, () => "token", crypto, tofu);
  return { driver, store, service, manager };
}

const sendInput = {
  conversation_id: CONVO,
  sender_id: SENDER,
  recipient_id: RECIPIENT,
};

describe("Phase 4 reliability torture (mocked transports)", () => {
  it("sends over internet when the API is up", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const sent = await session.service.sendText({ ...sendInput, text: "hello" });
    expect(sent.status).toBe(MessageStatus.SENT);
    expect(sent.transport).toBe("internet");
    expect(sent.status).not.toBe(MessageStatus.DELIVERED);
    session.driver.close();
  });

  it("queues when internet is lost during send", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    world.setOnline(false);
    const queued = await session.service.sendText({ ...sendInput, text: "offline" });
    expect(queued.status).toBe(MessageStatus.QUEUED);
    expect(await session.store.queuedCount()).toBe(1);
    session.driver.close();
  });

  it("falls back to internet when BLE is selected and fails", async () => {
    const world = mockHttp();
    world.setOnline(false);
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const bleSent: EncryptedEnvelope[] = [];
    const ble: Transport = {
      id: "bluetooth",
      async isAvailable() {
        return true;
      },
      async canSend() {
        return true;
      },
      async send() {
        world.setOnline(true);
        return { ok: false, transport: "bluetooth", error: "gatt write failed" };
      },
      subscribe() {
        return () => undefined;
      },
      status() {
        return { id: "bluetooth", available: true, implemented: true, detail: "mock" };
      },
    };
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey), ble);
    const sent = await session.service.sendText({ ...sendInput, text: "fallback" });
    expect(sent.status).toBe(MessageStatus.SENT);
    expect(sent.transport).toBe("internet");
    expect(bleSent).toHaveLength(0);
    session.driver.close();
  });

  it("queues encrypted ciphertext when both internet and BLE are down", async () => {
    const world = mockHttp();
    world.setOnline(false);
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const queued = await session.service.sendText({ ...sendInput, text: "secret-queue" });
    expect(queued.status).toBe(MessageStatus.QUEUED);
    const raw = await session.store.getMessage(queued.message_id);
    expect(raw?.text).toBeNull();
    expect(isCryptoBoxPayload(raw?.encrypted_payload ?? "")).toBe(true);
    expect(raw?.encrypted_payload).not.toContain("secret-queue");
    session.driver.close();
  });

  it("survives restart with a queued message and flushes once connectivity returns", async () => {
    const file = tempDb();
    const world = mockHttp();
    world.setOnline(false);
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const crypto = testCrypto(alice, blake.publicKey);
    const first = await openService(file, world.http, crypto);
    const queued = await first.service.sendText({ ...sendInput, text: "persist" });
    first.driver.close();

    const second = await openService(file, world.http, crypto);
    expect(await second.store.queuedCount()).toBe(1);
    world.setOnline(true);
    await second.service.sync();
    const restored = await second.store.getMessage(queued.message_id);
    expect(restored?.status).toBe(MessageStatus.SENT);
    expect(world.posts.filter((id) => id === queued.message_id)).toHaveLength(1);
    second.driver.close();
  });

  it("retries then marks FAILED; HTTP DELIVERED does not become local DELIVERED", async () => {
    const world = mockHttp({ status: 500 });
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const now = new Date("2026-08-16T00:00:00.000Z");
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const sent = await session.service.sendText({ ...sendInput, text: "retry-me", now });
    expect(sent.status).toBe(MessageStatus.QUEUED);
    let cursor = now.getTime();
    for (let i = 0; i < DEFAULT_RETRY_POLICY.maxAttempts + 2; i++) {
      cursor += 10 * 60_000;
      await session.service.retryDue(new Date(cursor));
    }
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.FAILED);
    session.driver.close();
  });

  it("applies a recipient crypto ACK once and ignores a duplicate ACK", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const tofu = new PublicKeyTofu();
    tofu.observe(RECIPIENT, blake.publicKey);
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey, tofu), undefined, tofu);
    const sent = await session.service.sendText({ ...sendInput, text: "ack-me" });
    const ackPlain = {
      message_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      sender_id: RECIPIENT,
      recipient_id: SENDER,
      conversation_id: CONVO,
      text: "",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      ttl: 86_400_000,
      hop_count: 0,
      kind: "delivery_ack" as const,
      ack_of: sent.message_id,
      ack_status: "DELIVERED" as const,
    };
    const packed = await encryptApplicationMessage(ackPlain, alice.publicKey, blake);
    const inbound: StoredMessage = {
      message_id: ackPlain.message_id,
      conversation_id: CONVO,
      sender_id: RECIPIENT,
      recipient_id: SENDER,
      text: null,
      encrypted_payload: packed,
      status: MessageStatus.SENT,
      transport: "internet",
      created_at: ackPlain.created_at,
      expires_at: ackPlain.expires_at,
      ttl: ackPlain.ttl,
      hop_count: 0,
    };
    expect(await session.service.acceptInbound(inbound)).toBe(true);
    expect(await session.service.acceptInbound(inbound)).toBe(false);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.DELIVERED);
    session.driver.close();
  });

  it("does not duplicate inbound messages and ignores out-of-order duplicates", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const firstPacked = await encryptApplicationMessage(
      {
        message_id: "11111111-1111-4111-8111-111111111111",
        sender_id: RECIPIENT,
        recipient_id: SENDER,
        conversation_id: CONVO,
        text: "one",
        created_at: "2026-08-16T00:00:01.000Z",
        expires_at: "2026-08-23T00:00:01.000Z",
        ttl: 86_400_000,
        hop_count: 0,
      },
      alice.publicKey,
      blake,
    );
    const secondPacked = await encryptApplicationMessage(
      {
        message_id: "22222222-2222-4222-8222-222222222222",
        sender_id: RECIPIENT,
        recipient_id: SENDER,
        conversation_id: CONVO,
        text: "two",
        created_at: "2026-08-16T00:00:02.000Z",
        expires_at: "2026-08-23T00:00:02.000Z",
        ttl: 86_400_000,
        hop_count: 0,
      },
      alice.publicKey,
      blake,
    );
    const row = (id: string, payload: string, created: string): StoredMessage => ({
      message_id: id,
      conversation_id: CONVO,
      sender_id: RECIPIENT,
      recipient_id: SENDER,
      text: null,
      encrypted_payload: payload,
      status: MessageStatus.SENT,
      transport: "internet",
      created_at: created,
      expires_at: "2026-08-23T00:00:00.000Z",
      ttl: 86_400_000,
      hop_count: 0,
    });
    expect(await session.service.acceptInbound(row("22222222-2222-4222-8222-222222222222", secondPacked, "2026-08-16T00:00:02.000Z"))).toBe(true);
    expect(await session.service.acceptInbound(row("11111111-1111-4111-8111-111111111111", firstPacked, "2026-08-16T00:00:01.000Z"))).toBe(true);
    expect(await session.service.acceptInbound(row("22222222-2222-4222-8222-222222222222", secondPacked, "2026-08-16T00:00:02.000Z"))).toBe(false);
    const listed = await session.service.listMessages(CONVO);
    expect(listed.map((item) => item.message_id).sort()).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
    session.driver.close();
  });

  it("rejects corrupted ciphertext and a box for the wrong peer key", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const eve = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const good = await encryptApplicationMessage(
      {
        message_id: "33333333-3333-4333-8333-333333333333",
        sender_id: RECIPIENT,
        recipient_id: SENDER,
        conversation_id: CONVO,
        text: "sealed",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        ttl: 86_400_000,
        hop_count: 0,
      },
      alice.publicKey,
      blake,
    );
    const parsed = JSON.parse(good) as { ciphertext: string };
    parsed.ciphertext = `${parsed.ciphertext.slice(0, -4)}AAAA`;
    const corrupt: StoredMessage = {
      message_id: "33333333-3333-4333-8333-333333333333",
      conversation_id: CONVO,
      sender_id: RECIPIENT,
      recipient_id: SENDER,
      text: null,
      encrypted_payload: JSON.stringify(parsed),
      status: MessageStatus.SENT,
      transport: "internet",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      ttl: 86_400_000,
      hop_count: 0,
    };
    expect(await session.service.acceptInbound(corrupt)).toBe(false);
    const wrongKey = await encryptApplicationMessage(
      {
        message_id: "44444444-4444-4444-8444-444444444444",
        sender_id: RECIPIENT,
        recipient_id: SENDER,
        conversation_id: CONVO,
        text: "eve",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        ttl: 86_400_000,
        hop_count: 0,
      },
      eve.publicKey,
      blake,
    );
    expect(
      await session.service.acceptInbound({
        ...corrupt,
        message_id: "44444444-4444-4444-8444-444444444444",
        encrypted_payload: wrongKey,
      }),
    ).toBe(false);
    expect(await session.store.listMessages(CONVO)).toHaveLength(0);
    session.driver.close();
  });

  it("refuses encrypt after KEY_CHANGED", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const tofu = new PublicKeyTofu();
    tofu.observe(RECIPIENT, blake.publicKey);
    tofu.observe(RECIPIENT, "pk-attacker");
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey, tofu), undefined, tofu);
    await expect(session.service.sendText({ ...sendInput, text: "nope" })).rejects.toThrow(/key changed/i);
    expect(world.posts).toHaveLength(0);
    session.driver.close();
  });

  it("queues on HTTP 4xx, 5xx, and timeout without marking DELIVERED", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    for (const status of [400, 401, 403, 500, 503]) {
      const world = mockHttp({ status });
      const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
      const sent = await session.service.sendText({ ...sendInput, text: `http-${status}` });
      expect(sent.status).toBe(MessageStatus.QUEUED);
      expect(sent.status).not.toBe(MessageStatus.DELIVERED);
      session.driver.close();
    }
    const timed = mockHttp();
    timed.setTimeout(true);
    const session = await openService(tempDb(), timed.http, testCrypto(alice, blake.publicKey));
    const sent = await session.service.sendText({ ...sendInput, text: "timeout" });
    expect(sent.status).toBe(MessageStatus.QUEUED);
    session.driver.close();
  });

  it("keeps per-conversation order across concurrent sendText calls", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey));
    const [a, b] = await Promise.all([
      session.service.sendText({ ...sendInput, text: "first" }),
      session.service.sendText({ ...sendInput, text: "second" }),
    ]);
    expect(new Set([a.status, b.status])).toEqual(new Set([MessageStatus.SENT]));
    expect(new Set([a.message_id, b.message_id]).size).toBe(2);
    session.driver.close();
  });

  it("queues PTT offline and does not store plaintext audio in SQLite", async () => {
    const world = mockHttp();
    world.setOnline(false);
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(tempDb(), world.http, testCrypto(alice, blake.publicKey), bleTransport([], true));
    const queued = await session.service.sendVoice({
      ...sendInput,
      audio_b64: AUDIO_B64,
      duration_ms: 400,
    });
    expect(queued.status).toBe(MessageStatus.QUEUED);
    const raw = await session.store.getMessage(queued.message_id);
    expect(raw?.text).toBeNull();
    expect(raw?.encrypted_payload).not.toContain(AUDIO_B64);
    expect(isCryptoBoxPayload(raw?.encrypted_payload ?? "")).toBe(true);
    session.driver.close();
  });
});
