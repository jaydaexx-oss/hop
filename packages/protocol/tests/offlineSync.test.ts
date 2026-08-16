import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  encryptApplicationMessage,
  generateIdentityKeyPair,
  decryptApplicationMessage,
  type IdentityKeyPair,
  type MessageCrypto,
} from "../src/index.js";
import type { HopHttpClient } from "../src/http.js";
import { InternetTransport } from "../src/internetTransport.js";
import { MessageStatus } from "../src/message.js";
import { MessageService } from "../src/messageService.js";
import { DEFAULT_RETRY_POLICY, nextBackoffMs } from "../src/retry.js";
import { SqlJsDriver } from "../src/sqlJsDriver.js";
import { HopSqliteStore, type StoredMessage } from "../src/store.js";
import { TransportManager } from "../src/transportManager.js";

const CONVO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SENDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECIPIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const sendInput = {
  conversation_id: CONVO,
  sender_id: SENDER,
  recipient_id: RECIPIENT,
};

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

function mockWorld(options?: { failPost?: boolean }) {
  let online = true;
  const posts: { message_id: string; encrypted_payload: string }[] = [];
  const server = new Map<string, Record<string, unknown>>();
  const http: HopHttpClient = {
    async request(path, init) {
      if (path === "/health") {
        return online
          ? { ok: true, status: 200, data: { status: "ok", service: "hop-api" } }
          : { ok: false, status: 0, data: null };
      }
      if (!online) {
        throw new Error("network down");
      }
      if (init?.method === "POST" && path.endsWith("/messages")) {
        if (options?.failPost) {
          return { ok: false, status: 500, data: { detail: "upstream" } };
        }
        const body = init.body as { encrypted_payload: string; message_id: string };
        posts.push({ message_id: body.message_id, encrypted_payload: body.encrypted_payload });
        const existing = server.get(body.message_id);
        if (existing) return { ok: true, status: 200, data: existing };
        const row = {
          message_id: body.message_id,
          conversation_id: CONVO,
          sender_id: SENDER,
          recipient_id: RECIPIENT,
          text: null,
          encrypted_payload: body.encrypted_payload,
          status: "SENT",
          transport: "internet",
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          ttl: 86_400_000,
          hop_count: 0,
          e2ee: true,
        };
        server.set(body.message_id, row);
        return { ok: true, status: 200, data: row };
      }
      if (path.endsWith("/messages")) {
        return { ok: true, status: 200, data: [...server.values()] };
      }
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
  };
}

async function openService(file: string, http: HopHttpClient, crypto: MessageCrypto) {
  const driver = await SqlJsDriver.open(file);
  const store = new HopSqliteStore(driver);
  await store.init();
  const manager = new TransportManager();
  manager.register(new InternetTransport(http));
  const service = new MessageService(store, manager, http, () => "token", crypto);
  return { driver, store, service, manager };
}

const tmpDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hop-offline-"));
  tmpDirs.push(dir);
  return path.join(dir, "hop.db");
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("offline persistence and sync", () => {
  it("Internet → send → disable internet → send → restart → reconnect → synchronize", async () => {
    const file = tempDb();
    const world = mockWorld();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const crypto = testCrypto(alice, blake.publicKey);

    const session1 = await openService(file, world.http, crypto);
    const onlineMsg = await session1.service.sendText({ ...sendInput, text: "online hello" });
    expect(onlineMsg.status).toBe(MessageStatus.SENT);
    expect(onlineMsg.encrypted_payload).not.toContain("online hello");
    expect(await session1.store.queuedCount()).toBe(0);
    expect(await session1.service.getNetworkStatus()).toBe("Online");

    world.setOnline(false);
    const queuedMsg = await session1.service.sendText({ ...sendInput, text: "offline hello" });
    expect(queuedMsg.status).toBe(MessageStatus.QUEUED);
    expect(queuedMsg.transport).toBe("local");
    expect(await session1.store.queuedCount()).toBe(1);
    expect(await session1.service.getNetworkStatus()).toBe("Queued");
    session1.driver.close();

    const session2 = await openService(file, world.http, crypto);
    const restored = await session2.service.listMessages(CONVO);
    expect(restored.map((row) => row.text).sort()).toEqual(["offline hello", "online hello"]);
    expect(restored.find((row) => row.text === "offline hello")?.status).toBe(MessageStatus.QUEUED);
    expect(await session2.store.queuedCount()).toBe(1);
    expect(await session2.store.hasProcessed(onlineMsg.message_id)).toBe(true);
    expect(await session2.store.hasProcessed(queuedMsg.message_id)).toBe(false);

    world.setOnline(true);
    await session2.service.sync();

    const synced = await session2.service.listMessages(CONVO);
    expect(synced).toHaveLength(2);
    expect(synced.find((row) => row.text === "offline hello")?.status).toBe(MessageStatus.SENT);
    expect(synced.find((row) => row.text === "offline hello")?.transport).toBe("internet");
    expect(await session2.store.queuedCount()).toBe(0);
    expect(world.posts.filter((post) => post.message_id === queuedMsg.message_id)).toHaveLength(1);
    expect(world.posts.filter((post) => post.message_id === onlineMsg.message_id)).toHaveLength(1);
    expect(world.posts[0]?.encrypted_payload).not.toContain("online hello");

    await session2.service.sync();
    expect(world.posts.filter((post) => post.message_id === queuedMsg.message_id)).toHaveLength(1);
    session2.driver.close();
  });

  it("applies an end-to-end delivery ack without duplicating the message", async () => {
    const file = tempDb();
    const world = mockWorld();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(file, world.http, testCrypto(alice, blake.publicKey));
    const sent = await session.service.sendText({ ...sendInput, text: "please ack" });
    expect(sent.status).toBe(MessageStatus.SENT);
    expect(await session.service.applyDeliveryAck(sent.message_id)).toBe(true);
    expect(await session.service.applyDeliveryAck(sent.message_id)).toBe(true);
    const rows = await session.service.listMessages(CONVO);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe(MessageStatus.DELIVERED);
    session.driver.close();
  });

  it("retries with exponential backoff while the server is failing", async () => {
    const file = tempDb();
    const world = mockWorld({ failPost: true });
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const now = new Date("2026-08-13T00:00:00.000Z");
    const session = await openService(file, world.http, testCrypto(alice, blake.publicKey));
    const sent = await session.service.sendText({ ...sendInput, text: "retry me", now });
    expect(sent.status).toBe(MessageStatus.QUEUED);

    const queued = (await session.store.listOutbound())[0];
    expect(queued.attempts).toBe(1);
    expect(queued.next_retry_at).toBe(now.getTime() + (nextBackoffMs(1) ?? 0));
    expect(queued.next_retry_at).toBe(now.getTime() + 2_000);

    await session.service.retryDue(new Date(now.getTime() + 1_000));
    expect((await session.store.listOutbound())[0].attempts).toBe(1);

    await session.service.retryDue(new Date(now.getTime() + 2_000));
    const afterSecond = (await session.store.listOutbound())[0];
    expect(afterSecond.attempts).toBe(2);
    expect(afterSecond.next_retry_at).toBe(now.getTime() + 2_000 + (nextBackoffMs(2) ?? 0));
    expect(nextBackoffMs(2)).toBe(4_000);
    expect(nextBackoffMs(DEFAULT_RETRY_POLICY.maxAttempts)).toBeNull();
    session.driver.close();
  });

  it("drops duplicate inbound message ids across app restart", async () => {
    const file = tempDb();
    const world = mockWorld();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const crypto = testCrypto(alice, blake.publicKey);
    const inbound: StoredMessage = {
      message_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      conversation_id: CONVO,
      sender_id: RECIPIENT,
      recipient_id: SENDER,
      text: "from peer",
      encrypted_payload: "e30=",
      status: MessageStatus.DELIVERED,
      transport: "internet",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      ttl: 86_400_000,
      hop_count: 0,
    };

    const session1 = await openService(file, world.http, crypto);
    expect(await session1.service.acceptInbound(inbound)).toBe(true);
    expect(await session1.service.acceptInbound(inbound)).toBe(false);
    session1.driver.close();

    const session2 = await openService(file, world.http, crypto);
    expect(await session2.service.acceptInbound(inbound)).toBe(false);
    expect(await session2.service.listMessages(CONVO)).toHaveLength(1);
    session2.driver.close();
  });

  it("sends over BLE when internet is down and the recipient is nearby", async () => {
    const file = tempDb();
    const world = mockWorld();
    world.setOnline(false);
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(file, world.http, testCrypto(alice, blake.publicKey));
    const bleSent: string[] = [];
    session.manager.register({
      id: "bluetooth",
      async isAvailable() {
        return true;
      },
      async canSend() {
        return true;
      },
      async send(envelope) {
        bleSent.push(envelope.message_id);
        return { ok: true, transport: "bluetooth" };
      },
      subscribe() {
        return () => undefined;
      },
      status() {
        return { id: "bluetooth", available: true, implemented: true, detail: "mock" };
      },
    });

    const sent = await session.service.sendText({ ...sendInput, text: "nearby hello" });
    expect(sent.status).toBe(MessageStatus.SENT);
    expect(sent.transport).toBe("bluetooth");
    expect(bleSent).toEqual([sent.message_id]);
    expect(await session.store.queuedCount()).toBe(0);
    expect(await session.service.getNetworkStatus()).toBe("Nearby");
    session.driver.close();
  });

  it("does not persist decrypted plaintext for crypto_box messages", async () => {
    const file = tempDb();
    const world = mockWorld();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(file, world.http, testCrypto(alice, blake.publicKey));
    const sent = await session.service.sendText({ ...sendInput, text: "secret at rest" });
    const raw = await session.store.getMessage(sent.message_id);
    expect(raw?.text).toBeNull();
    expect(raw?.local_seal).toBeTruthy();
    expect(raw?.local_seal).not.toContain("secret at rest");
    session.driver.close();
  });
});
