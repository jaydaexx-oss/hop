import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  conversationPreviewLine,
  decryptApplicationMessage,
  encryptApplicationMessage,
  generateIdentityKeyPair,
  type IdentityKeyPair,
  type MessageCrypto,
} from "../src/index.js";
import type { HopHttpClient } from "../src/http.js";
import { InternetTransport } from "../src/internetTransport.js";
import { MessageStatus } from "../src/message.js";
import { MessageService } from "../src/messageService.js";
import { SqlJsDriver } from "../src/sqlJsDriver.js";
import { HopSqliteStore, type StoredMessage } from "../src/store.js";
import { TransportManager } from "../src/transportManager.js";

const CONVO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SENDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECIPIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
  const posts: string[] = [];
  const http: HopHttpClient = {
    async request(path, init) {
      if (path === "/health") {
        return online
          ? { ok: true, status: 200, data: { status: "ok" } }
          : { ok: false, status: 0, data: null };
      }
      if (!online) throw new Error("network down");
      if (init?.method === "POST" && path.endsWith("/messages")) {
        const body = init.body as { message_id: string };
        posts.push(body.message_id);
        return { ok: true, status: 200, data: { status: "DELIVERED", message_id: body.message_id } };
      }
      if (path.endsWith("/messages")) return { ok: true, status: 200, data: [] };
      return { ok: false, status: 404, data: null };
    },
  };
  return {
    http,
    posts,
    setOnline(value: boolean) {
      online = value;
    },
  };
}

const tmpDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hop-phase3-"));
  tmpDirs.push(dir);
  return path.join(dir, "hop.db");
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

async function openService(file: string, http: HopHttpClient, crypto: MessageCrypto) {
  const driver = await SqlJsDriver.open(file);
  const store = new HopSqliteStore(driver);
  await store.init();
  const manager = new TransportManager();
  manager.register(new InternetTransport(http));
  const service = new MessageService(store, manager, http, () => "token", crypto);
  return { driver, store, service, manager };
}

describe("Phase 3 reliability", () => {
  it("never marks DELIVERED from an HTTP DELIVERED status", async () => {
    const file = tempDb();
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(file, world.http, testCrypto(alice, blake.publicKey));
    const sent = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: SENDER,
      recipient_id: RECIPIENT,
      text: "need a real ack",
    });
    expect(sent.status).toBe(MessageStatus.SENT);
    expect(sent.status).not.toBe(MessageStatus.DELIVERED);
    session.driver.close();
  });

  it("drops a duplicate inbound message_id via processed_ids", async () => {
    const file = tempDb();
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const crypto = testCrypto(alice, blake.publicKey);
    const packed = await encryptApplicationMessage(
      {
        message_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        sender_id: RECIPIENT,
        recipient_id: SENDER,
        conversation_id: CONVO,
        text: "once only",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        ttl: 86_400_000,
        hop_count: 0,
      },
      alice.publicKey,
      blake,
    );
    const inbound: StoredMessage = {
      message_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      conversation_id: CONVO,
      sender_id: RECIPIENT,
      recipient_id: SENDER,
      text: null,
      encrypted_payload: packed,
      status: MessageStatus.SENT,
      transport: "internet",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      ttl: 86_400_000,
      hop_count: 0,
    };
    const session = await openService(file, world.http, crypto);
    expect(await session.service.acceptInbound(inbound)).toBe(true);
    expect(await session.service.acceptInbound(inbound)).toBe(false);
    expect(await session.service.listMessages(CONVO)).toHaveLength(1);
    session.driver.close();
  });

  it("queues when Bluetooth throws and internet is down", async () => {
    const file = tempDb();
    const world = mockHttp();
    world.setOnline(false);
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(file, world.http, testCrypto(alice, blake.publicKey));
    session.manager.register({
      id: "bluetooth",
      async isAvailable() {
        throw new Error("Bluetooth unavailable");
      },
      async send() {
        throw new Error("Bluetooth unavailable");
      },
      subscribe() {
        return () => undefined;
      },
      status() {
        return { id: "bluetooth", available: false, implemented: true, detail: "throwing" };
      },
    });
    const sent = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: SENDER,
      recipient_id: RECIPIENT,
      text: "queue me",
    });
    expect(sent.status).toBe(MessageStatus.QUEUED);
    expect(sent.transport).toBe("local");
    expect(await session.store.queuedCount()).toBe(1);
    session.driver.close();
  });

  it("preview decrypts caption locally and never returns ciphertext", async () => {
    const file = tempDb();
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(file, world.http, testCrypto(alice, blake.publicKey));
    const sent = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: SENDER,
      recipient_id: RECIPIENT,
      text: "preview hello",
    });
    const preview = await session.service.previewForConversation(CONVO);
    expect(preview).toBe("preview hello");
    expect(preview).not.toContain(sent.encrypted_payload.slice(0, 24));
    expect(conversationPreviewLine({ text: null, encrypted_payload: sent.encrypted_payload })).toBe(
      "Encrypted message",
    );
    session.driver.close();
  });
});
