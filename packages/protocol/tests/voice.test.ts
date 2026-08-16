import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_VOICE_AUDIO_B64_CHARS,
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
const FIXTURE = "HOP_VOICE_FIXTURE_DO_NOT_LEAK";
const AUDIO_B64 = Buffer.from(FIXTURE, "utf8").toString("base64");

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

function mockWorld() {
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
  const dir = mkdtempSync(path.join(tmpdir(), "hop-voice-"));
  tmpDirs.push(dir);
  return path.join(dir, "hop.db");
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("voice messages", () => {
  it("sends a voice clip over internet without leaking plaintext audio", async () => {
    const file = tempDb();
    const world = mockWorld();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(file, world.http, testCrypto(alice, blake.publicKey));
    const sent = await session.service.sendVoice({
      ...sendInput,
      audio_b64: AUDIO_B64,
      duration_ms: 1500,
      mime: "audio/mp4",
    });
    expect(sent.status).toBe(MessageStatus.SENT);
    expect(sent.transport).toBe("internet");
    expect(sent.kind).toBe("voice");
    expect(sent.duration_ms).toBe(1500);
    expect(sent.mime).toBe("audio/mp4");
    expect(sent.audio_b64).toBe(AUDIO_B64);
    expect(sent.text).toBe("Voice message");
    expect(sent.encrypted_payload).not.toContain(FIXTURE);
    expect(sent.encrypted_payload).not.toContain(AUDIO_B64);
    expect(world.posts).toHaveLength(1);
    expect(world.posts[0]?.encrypted_payload).not.toContain(FIXTURE);
    expect(world.posts[0]?.encrypted_payload).not.toContain(AUDIO_B64);

    const raw = await session.store.getMessage(sent.message_id);
    expect(raw?.text).toBeNull();
    expect(raw?.local_seal).toBeTruthy();
    expect(raw?.local_seal).not.toContain(FIXTURE);

    const listed = await session.service.listMessages(CONVO);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.kind).toBe("voice");
    expect(listed[0]?.audio_b64).toBe(AUDIO_B64);
    expect(listed[0]?.duration_ms).toBe(1500);
    session.driver.close();
  });

  it("routes voice over BLE when internet is down and the recipient is nearby", async () => {
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
        expect(envelope.encrypted_payload).not.toContain(FIXTURE);
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

    const sent = await session.service.sendVoice({
      ...sendInput,
      audio_b64: AUDIO_B64,
      duration_ms: 900,
    });
    expect(sent.status).toBe(MessageStatus.SENT);
    expect(sent.transport).toBe("bluetooth");
    expect(bleSent).toEqual([sent.message_id]);
    expect(await session.store.queuedCount()).toBe(0);
    session.driver.close();
  });

  it("queues voice offline and flushes the same message_id after restart", async () => {
    const file = tempDb();
    const world = mockWorld();
    world.setOnline(false);
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const crypto = testCrypto(alice, blake.publicKey);

    const session1 = await openService(file, world.http, crypto);
    const queued = await session1.service.sendVoice({
      ...sendInput,
      audio_b64: AUDIO_B64,
      duration_ms: 800,
    });
    expect(queued.status).toBe(MessageStatus.QUEUED);
    expect(queued.transport).toBe("local");
    expect(await session1.store.queuedCount()).toBe(1);
    const messageId = queued.message_id;
    session1.driver.close();

    const session2 = await openService(file, world.http, crypto);
    const restored = await session2.service.listMessages(CONVO);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.message_id).toBe(messageId);
    expect(restored[0]?.kind).toBe("voice");
    expect(restored[0]?.status).toBe(MessageStatus.QUEUED);
    expect(restored[0]?.audio_b64).toBe(AUDIO_B64);
    expect(await session2.store.queuedCount()).toBe(1);

    world.setOnline(true);
    await session2.service.sync();
    const synced = await session2.service.listMessages(CONVO);
    expect(synced[0]?.status).toBe(MessageStatus.SENT);
    expect(synced[0]?.transport).toBe("internet");
    expect(synced[0]?.message_id).toBe(messageId);
    expect(world.posts.filter((post) => post.message_id === messageId)).toHaveLength(1);

    await session2.service.sync();
    expect(world.posts.filter((post) => post.message_id === messageId)).toHaveLength(1);
    session2.driver.close();
  });

  it("does not duplicate inbound voice across acceptInbound retries", async () => {
    const file = tempDb();
    const world = mockWorld();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const packed = await encryptApplicationMessage(
      {
        message_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        sender_id: RECIPIENT,
        recipient_id: SENDER,
        conversation_id: CONVO,
        text: "Voice message",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        ttl: 86_400_000,
        hop_count: 0,
        kind: "voice",
        audio_b64: AUDIO_B64,
        duration_ms: 400,
        mime: "audio/mp4",
        seq: 0,
        total: 1,
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
      status: MessageStatus.DELIVERED,
      transport: "internet",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      ttl: 86_400_000,
      hop_count: 0,
    };

    const session = await openService(file, world.http, testCrypto(alice, blake.publicKey));
    expect(await session.service.acceptInbound(inbound)).toBe(true);
    expect(await session.service.acceptInbound(inbound)).toBe(false);
    const rows = await session.service.listMessages(CONVO);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("voice");
    expect(rows[0]?.audio_b64).toBe(AUDIO_B64);
    const raw = await session.store.getMessage(inbound.message_id);
    expect(raw?.text).toBeNull();
    session.driver.close();
  });

  it("rejects oversized and overlong recordings before they are queued", async () => {
    const file = tempDb();
    const world = mockWorld();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(file, world.http, testCrypto(alice, blake.publicKey));

    await expect(
      session.service.sendVoice({
        ...sendInput,
        audio_b64: AUDIO_B64,
        duration_ms: 8_001,
      }),
    ).rejects.toThrow(/8 second/i);

    await expect(
      session.service.sendVoice({
        ...sendInput,
        audio_b64: "A".repeat(MAX_VOICE_AUDIO_B64_CHARS + 1),
        duration_ms: 1000,
      }),
    ).rejects.toThrow(/maximum size/i);

    expect(await session.store.queuedCount()).toBe(0);
    expect(await session.store.listMessages(CONVO)).toHaveLength(0);
    expect(world.posts).toHaveLength(0);
    session.driver.close();
  });

  it("keeps existing text messaging compatible alongside voice", async () => {
    const file = tempDb();
    const world = mockWorld();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(file, world.http, testCrypto(alice, blake.publicKey));
    const text = await session.service.sendText({ ...sendInput, text: "still works" });
    const voice = await session.service.sendVoice({
      ...sendInput,
      audio_b64: AUDIO_B64,
      duration_ms: 500,
    });
    expect(text.status).toBe(MessageStatus.SENT);
    expect(voice.status).toBe(MessageStatus.SENT);
    const listed = await session.service.listMessages(CONVO);
    expect(listed.map((row) => row.text).sort()).toEqual(["Voice message", "still works"]);
    expect(listed.find((row) => row.text === "still works")?.kind ?? "message").toBe("message");
    expect(listed.find((row) => row.kind === "voice")?.audio_b64).toBe(AUDIO_B64);
    session.driver.close();
  });
});
