import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CRYPTO_BOX_ALG,
  SCHEMA_SQL,
  decryptApplicationMessage,
  encryptApplicationMessage,
  generateIdentityKeyPair,
  isCryptoBoxPayload,
  localDirectConversationId,
  requirePeerRecipient,
  type IdentityKeyPair,
  type MessageCrypto,
} from "../src/index.js";
import type { HopHttpClient } from "../src/http.js";
import { InternetTransport } from "../src/internetTransport.js";
import { MessageStatus } from "../src/message.js";
import { MessageService } from "../src/messageService.js";
import { encodeUnencryptedText } from "../src/payload.js";
import { SqlJsDriver } from "../src/sqlJsDriver.js";
import { HopSqliteStore, type StoredMessage } from "../src/store.js";
import { toEnvelope, type EncryptedEnvelope, type SendResult, type Transport } from "../src/transport.js";
import { TransportManager } from "../src/transportManager.js";

const CONVO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SENDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECIPIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEXT_SECRET = "HOP_TEXT_MUST_NOT_LEAVE_PLAIN";
const VOICE_FIXTURE = "HOP_VOICE_FIXTURE_DO_NOT_LEAK";
const AUDIO_B64 = Buffer.from(VOICE_FIXTURE, "utf8").toString("base64");

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
  const http: HopHttpClient = {
    async request(path, init) {
      if (path === "/health") {
        return online
          ? { ok: true, status: 200, data: { status: "ok", service: "hop-api" } }
          : { ok: false, status: 0, data: null };
      }
      if (!online) throw new Error("network down");
      if (init?.method === "POST" && path.endsWith("/messages")) {
        const body = init.body as { encrypted_payload: string; message_id: string };
        posts.push({ message_id: body.message_id, encrypted_payload: body.encrypted_payload });
        return {
          ok: true,
          status: 200,
          data: { message_id: body.message_id, encrypted_payload: body.encrypted_payload, status: "SENT" },
        };
      }
      if (path.endsWith("/messages")) {
        return { ok: true, status: 200, data: [] };
      }
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

function recordingTransport(id: "internet" | "bluetooth", sent: EncryptedEnvelope[]): Transport {
  return {
    id,
    async isAvailable() {
      return true;
    },
    async canSend() {
      return true;
    },
    async send(envelope): Promise<SendResult> {
      sent.push(envelope);
      return { ok: true, transport: id };
    },
    subscribe() {
      return () => undefined;
    },
    status() {
      return { id, available: true, implemented: true, detail: "recorder" };
    },
  };
}

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

const tmpDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hop-stab-"));
  tmpDirs.push(dir);
  return path.join(dir, "hop.db");
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("production stabilization invariants", () => {
  it("1. text cannot leave TransportManager as plaintext", async () => {
    const sent: EncryptedEnvelope[] = [];
    const manager = new TransportManager();
    manager.register(recordingTransport("internet", sent));
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const boxed = await encryptApplicationMessage(
      {
        message_id: "11111111-1111-4111-8111-111111111111",
        sender_id: SENDER,
        recipient_id: RECIPIENT,
        conversation_id: CONVO,
        text: TEXT_SECRET,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        ttl: 86_400_000,
        hop_count: 0,
      },
      blake.publicKey,
      alice,
    );
    const ok = await manager.send(
      toEnvelope({
        message_id: "11111111-1111-4111-8111-111111111111",
        sender_id: SENDER,
        recipient_id: RECIPIENT,
        conversation_id: CONVO,
        encrypted_payload: boxed,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        ttl: 86_400_000,
        hop_count: 0,
        transport: "internet",
        status: MessageStatus.SENDING,
      }),
    );
    expect(ok.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(isCryptoBoxPayload(sent[0]!.encrypted_payload)).toBe(true);
    expect(sent[0]!.encrypted_payload).not.toContain(TEXT_SECRET);
    expect(JSON.parse(sent[0]!.encrypted_payload).alg).toBe(CRYPTO_BOX_ALG);

    const raw = await manager.send(
      toEnvelope({
        message_id: "22222222-2222-4222-8222-222222222222",
        sender_id: SENDER,
        recipient_id: RECIPIENT,
        conversation_id: CONVO,
        encrypted_payload: TEXT_SECRET,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        ttl: 86_400_000,
        hop_count: 0,
        transport: "internet",
        status: MessageStatus.SENDING,
      }),
    );
    expect(raw.ok).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("2. voice cannot leave TransportManager as plaintext", async () => {
    const file = tempDb();
    const world = mockWorld();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const bleSent: EncryptedEnvelope[] = [];
    const session = await openService(
      file,
      world.http,
      testCrypto(alice, blake.publicKey),
      recordingTransport("bluetooth", bleSent),
    );
    world.setOnline(false);
    const sent = await session.service.sendVoice({
      ...sendInput,
      audio_b64: AUDIO_B64,
      duration_ms: 900,
    });
    expect(sent.transport).toBe("bluetooth");
    expect(bleSent).toHaveLength(1);
    expect(isCryptoBoxPayload(bleSent[0]!.encrypted_payload)).toBe(true);
    expect(bleSent[0]!.encrypted_payload).not.toContain(VOICE_FIXTURE);
    expect(bleSent[0]!.encrypted_payload).not.toContain(AUDIO_B64);
    expect(JSON.parse(bleSent[0]!.encrypted_payload).alg).toBe(CRYPTO_BOX_ALG);
    session.driver.close();
  });

  it("3. plaintext voice is not durably persisted (store text null, no audio in sqlite)", async () => {
    const file = tempDb();
    const world = mockWorld();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(file, world.http, testCrypto(alice, blake.publicKey));
    const sent = await session.service.sendVoice({
      ...sendInput,
      audio_b64: AUDIO_B64,
      duration_ms: 700,
    });
    const raw = await session.store.getMessage(sent.message_id);
    expect(raw?.text).toBeNull();
    expect(raw?.audio_b64).toBeUndefined();
    expect(SCHEMA_SQL).not.toMatch(/audio_b64/i);
    expect(SCHEMA_SQL.toLowerCase().includes("audio")).toBe(false);
    const columns = await session.driver.query<{ name: string }>("PRAGMA table_info(messages)");
    expect(columns.map((col) => col.name)).not.toContain("audio_b64");
    expect(columns.map((col) => col.name)).not.toContain("audio");
    const leaked = JSON.stringify(raw);
    expect(leaked).not.toContain(VOICE_FIXTURE);
    expect(leaked).not.toContain(AUDIO_B64);
    expect(world.posts[0]?.encrypted_payload).not.toContain(AUDIO_B64);
    session.driver.close();
  });

  it("4. alg:none is rejected on internet, BLE, and TransportManager", async () => {
    const none = encodeUnencryptedText("secret");
    const envelope = toEnvelope({
      message_id: "33333333-3333-4333-8333-333333333333",
      sender_id: SENDER,
      recipient_id: RECIPIENT,
      conversation_id: CONVO,
      encrypted_payload: none,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      ttl: 86_400_000,
      hop_count: 0,
      transport: "internet",
      status: MessageStatus.SENDING,
    });
    const internetSent: EncryptedEnvelope[] = [];
    const bleSent: EncryptedEnvelope[] = [];
    const manager = new TransportManager();
    manager.register(recordingTransport("internet", internetSent));
    manager.register(recordingTransport("bluetooth", bleSent));
    const tm = await manager.send(envelope);
    expect(tm.ok).toBe(false);
    expect(tm.error).toMatch(/alg:none|plaintext/i);
    expect(internetSent).toHaveLength(0);
    expect(bleSent).toHaveLength(0);

    const internet = new InternetTransport({
      async request() {
        throw new Error("must not POST plaintext");
      },
    });
    expect((await internet.send(envelope)).ok).toBe(false);
  });

  it("5. PTT uses the same TransportManager as text", async () => {
    const file = tempDb();
    const world = mockWorld();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(file, world.http, testCrypto(alice, blake.publicKey));
    const text = await session.service.sendText({ ...sendInput, text: "hello" });
    const voice = await session.service.sendVoice({
      ...sendInput,
      audio_b64: AUDIO_B64,
      duration_ms: 400,
    });
    expect(text.transport).toBe("internet");
    expect(voice.transport).toBe("internet");
    expect(world.posts).toHaveLength(2);
    expect(world.posts.map((post) => post.message_id).sort()).toEqual(
      [text.message_id, voice.message_id].sort(),
    );
    for (const post of world.posts) {
      expect(isCryptoBoxPayload(post.encrypted_payload)).toBe(true);
    }
    session.driver.close();
  });

  it("6. Nearby messages pass through MessageService (openPeerConversation + send)", async () => {
    const file = tempDb();
    const world = mockWorld();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(file, world.http, testCrypto(alice, blake.publicKey));
    const nearbyId = localDirectConversationId(SENDER, RECIPIENT);
    expect(nearbyId.startsWith("ble:")).toBe(true);
    const sent = await session.service.sendText({
      conversation_id: nearbyId,
      sender_id: SENDER,
      recipient_id: RECIPIENT,
      text: "nearby chat",
    });
    expect(sent.conversation_id).toBe(nearbyId);
    expect(world.posts).toHaveLength(1);
    expect(isCryptoBoxPayload(world.posts[0]!.encrypted_payload)).toBe(true);
    expect(world.posts[0]!.encrypted_payload).not.toContain("nearby chat");
    expect(() => requirePeerRecipient(SENDER, SENDER)).toThrow(/recipient/i);
    expect(() => requirePeerRecipient(SENDER, "")).toThrow(/recipient/i);
    session.driver.close();
  });

  it("7. offline encrypted voice survives restart", async () => {
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
    const rawQueued = await session1.store.getMessage(queued.message_id);
    expect(rawQueued?.text).toBeNull();
    expect(isCryptoBoxPayload(rawQueued?.encrypted_payload ?? "")).toBe(true);
    session1.driver.close();

    const session2 = await openService(file, world.http, crypto);
    const restored = await session2.service.listMessages(CONVO);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.message_id).toBe(queued.message_id);
    expect(restored[0]?.kind).toBe("voice");
    expect(restored[0]?.audio_b64).toBe(AUDIO_B64);
    expect(await session2.store.queuedCount()).toBe(1);
    world.setOnline(true);
    await session2.service.sync();
    const synced = await session2.store.getMessage(queued.message_id);
    expect(synced?.status).toBe(MessageStatus.SENT);
    expect(synced?.text).toBeNull();
    expect(world.posts.filter((post) => post.message_id === queued.message_id)).toHaveLength(1);
    session2.driver.close();
  });

  it("8. duplicate inbound voice is not delivered twice", async () => {
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
    expect(await session.service.acceptInbound(inbound)).toBe(false);
    expect(await session.service.listMessages(CONVO)).toHaveLength(1);
    session.driver.close();
  });

  it("fails send without a real recipient instead of self-encrypting", async () => {
    const file = tempDb();
    const world = mockWorld();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(file, world.http, testCrypto(alice, blake.publicKey));
    await expect(
      session.service.sendText({ conversation_id: CONVO, sender_id: SENDER, recipient_id: "", text: "nope" }),
    ).rejects.toThrow(/recipient/i);
    await expect(
      session.service.sendText({ conversation_id: CONVO, sender_id: SENDER, recipient_id: SENDER, text: "nope" }),
    ).rejects.toThrow(/recipient/i);
    await expect(
      session.service.sendVoice({
        conversation_id: CONVO,
        sender_id: SENDER,
        recipient_id: SENDER,
        audio_b64: AUDIO_B64,
        duration_ms: 100,
      }),
    ).rejects.toThrow(/recipient/i);
    expect(world.posts).toHaveLength(0);
    expect(await session.store.listMessages(CONVO)).toHaveLength(0);
    session.driver.close();
  });
});
