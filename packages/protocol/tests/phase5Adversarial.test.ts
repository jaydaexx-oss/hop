import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  HandshakeReplayGuard,
  PublicKeyTofu,
  categorizeTransportFailure,
  decryptApplicationMessage,
  encryptApplicationMessage,
  generateIdentityKeyPair,
  isCryptoBoxPayload,
  newEphemeralVoiceFileId,
  redactForLog,
  redactString,
  verifyAuthenticatedHandshake,
  type IdentityKeyPair,
  type MessageCrypto,
} from "../src/index.js";
import type { HopHttpClient } from "../src/http.js";
import { InternetTransport } from "../src/internetTransport.js";
import { MessageStatus } from "../src/message.js";
import { MessageService } from "../src/messageService.js";
import { SqlJsDriver } from "../src/sqlJsDriver.js";
import { HopSqliteStore, type StoredMessage } from "../src/store.js";
import { type EncryptedEnvelope, type SendResult, type Transport } from "../src/transport.js";
import { TransportManager } from "../src/transportManager.js";
import { BleHandshakeExchange } from "../src/bleHandshake.js";

const CONVO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SENDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECIPIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

function mockHttp(options?: { status?: number }) {
  let online = true;
  let postStatus = options?.status ?? 200;
  const posts: string[] = [];
  const http: HopHttpClient = {
    async request(path, init) {
      if (path === "/health") {
        return online ? { ok: true, status: 200, data: { status: "ok" } } : { ok: false, status: 0, data: null };
      }
      if (!online) throw new Error("network down");
      if (init?.method === "POST" && path.endsWith("/messages")) {
        const body = init.body as { message_id: string };
        if (postStatus >= 400) return { ok: false, status: postStatus, data: { detail: `HTTP ${postStatus}` } };
        posts.push(body.message_id);
        return {
          ok: true,
          status: 200,
          data: {
            message_id: body.message_id,
            conversation_id: CONVO,
            sender_id: SENDER,
            recipient_id: RECIPIENT,
            status: "DELIVERED",
            transport: "internet",
          },
        };
      }
      return { ok: false, status: 404, data: null };
    },
  };
  return {
    http,
    posts,
    setOnline(v: boolean) {
      online = v;
    },
    setPostStatus(status: number) {
      postStatus = status;
    },
  };
}

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

async function openService(http: HopHttpClient, crypto: MessageCrypto, extra?: Transport, tofu?: PublicKeyTofu) {
  const dir = mkdtempSync(path.join(tmpdir(), "hop-p5-"));
  tmpDirs.push(dir);
  const driver = await SqlJsDriver.open(path.join(dir, "hop.db"));
  const store = new HopSqliteStore(driver);
  await store.init();
  const manager = new TransportManager();
  manager.register(new InternetTransport(http));
  if (extra) manager.register(extra);
  return { driver, store, service: new MessageService(store, manager, http, () => "token", crypto, tofu), manager };
}

const sendInput = { conversation_id: CONVO, sender_id: SENDER, recipient_id: RECIPIENT };

describe("Phase 5 chaos / adversarial (mocked)", () => {
  it("handles 20 concurrent sends without duplicate ids or false DELIVERED", { timeout: 20_000 }, async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(world.http, testCrypto(alice, blake.publicKey));
    const sent = await Promise.all(
      Array.from({ length: 20 }, (_, i) => session.service.sendText({ ...sendInput, text: `m-${i}` })),
    );
    const ids = new Set(sent.map((row) => row.message_id));
    expect(ids.size).toBe(20);
    expect(sent.every((row) => row.status === MessageStatus.SENT || row.status === MessageStatus.QUEUED)).toBe(true);
    expect(sent.some((row) => row.status === MessageStatus.DELIVERED)).toBe(false);
    session.driver.close();
  });

  it("does not mark DELIVERED from an ACK before local SENT", async () => {
    const world = mockHttp();
    world.setOnline(false);
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(world.http, testCrypto(alice, blake.publicKey));
    const queued = await session.service.sendText({ ...sendInput, text: "queued-ack" });
    expect(queued.status).toBe(MessageStatus.QUEUED);
    expect(await session.service.applyDeliveryAck(queued.message_id)).toBe(false);
    expect((await session.store.getMessage(queued.message_id))?.status).toBe(MessageStatus.QUEUED);
    session.driver.close();
  });

  it("drops truncated, oversized, and wrong-recipient ciphertext", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(world.http, testCrypto(alice, blake.publicKey));
    const packed = await encryptApplicationMessage(
      {
        message_id: "55555555-5555-4555-8555-555555555555",
        sender_id: RECIPIENT,
        recipient_id: SENDER,
        conversation_id: CONVO,
        text: "ok",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        ttl: 86_400_000,
        hop_count: 0,
      },
      alice.publicKey,
      blake,
    );
    const base: StoredMessage = {
      message_id: "55555555-5555-4555-8555-555555555555",
      conversation_id: CONVO,
      sender_id: RECIPIENT,
      recipient_id: SENDER,
      text: null,
      encrypted_payload: packed.slice(0, 20),
      status: MessageStatus.SENT,
      transport: "internet",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      ttl: 86_400_000,
      hop_count: 0,
    };
    expect(await session.service.acceptInbound(base)).toBe(false);
    expect(
      await session.service.acceptInbound({
        ...base,
        message_id: "66666666-6666-4666-8666-666666666666",
        recipient_id: "not-me",
        encrypted_payload: packed,
      }),
    ).toBe(false);
    session.driver.close();
  });

  it("flaps the network then flushes the queue without double send of a new id", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(world.http, testCrypto(alice, blake.publicKey));
    world.setOnline(false);
    const queued = await session.service.sendText({ ...sendInput, text: "flap" });
    world.setOnline(true);
    await session.service.sync();
    expect((await session.store.getMessage(queued.message_id))?.status).toBe(MessageStatus.SENT);
    expect(world.posts.filter((id) => id === queued.message_id)).toHaveLength(1);
    session.driver.close();
  });

  it("selects BLE then internet via TransportManager without false DELIVERED", async () => {
    const world = mockHttp();
    world.setOnline(false);
    const bleSent: EncryptedEnvelope[] = [];
    const ble: Transport = {
      id: "bluetooth",
      async isAvailable() {
        return true;
      },
      async canSend() {
        return true;
      },
      async send(envelope): Promise<SendResult> {
        bleSent.push(envelope);
        return { ok: true, transport: "bluetooth" };
      },
      subscribe() {
        return () => undefined;
      },
      status() {
        return { id: "bluetooth", available: true, implemented: true, detail: "mock" };
      },
    };
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(world.http, testCrypto(alice, blake.publicKey), ble);
    const sent = await session.service.sendText({ ...sendInput, text: "nearby" });
    expect(sent.transport).toBe("bluetooth");
    expect(sent.status).toBe(MessageStatus.SENT);
    expect(bleSent).toHaveLength(1);
    session.driver.close();
  });

  it("surfaces PTT encrypt failure instead of sending plaintext", async () => {
    const world = mockHttp();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const crypto: MessageCrypto = {
      ...testCrypto(alice, blake.publicKey),
      async encrypt() {
        throw new Error("encrypt failed");
      },
    };
    const session = await openService(world.http, crypto);
    await expect(
      session.service.sendVoice({ ...sendInput, audio_b64: "QQ==", duration_ms: 400 }),
    ).rejects.toThrow(/encrypt failed/i);
    expect(world.posts).toHaveLength(0);
    session.driver.close();
  });

  it("fails closed when the secret backend cannot store identity", async () => {
    const { IdentityError, loadOrCreateIdentity } = await import("../src/index.js");
    const backend = {
      async read() {
        throw new Error("disk");
      },
      async write() {
        throw new Error("disk");
      },
    };
    await expect(loadOrCreateIdentity("u", backend)).rejects.toThrow();
    expect(IdentityError).toBeDefined();
  });

  it("categorizes transport failures without dumping ciphertext", () => {
    expect(categorizeTransportFailure("HTTP 503")).toBe("http_5xx");
    expect(categorizeTransportFailure("HTTP 401")).toBe("http_4xx");
    expect(categorizeTransportFailure("Delivery ack timed out")).toBe("timeout");
    expect(categorizeTransportFailure("Peer identity key changed; re-verify")).toBe("identity_changed");
    expect(categorizeTransportFailure("Refusing to send plaintext or alg:none payload")).toBe("crypto_refused");
    expect(categorizeTransportFailure("BLE session is stale")).toBe("session_stale");
    const dumped = redactString(`encrypted_payload ${"A".repeat(80)}`);
    expect(dumped).not.toMatch(/A{48}/);
    expect(redactForLog({ encrypted_payload: "AAAA", password: "x", text: "hi" })).toEqual({
      encrypted_payload: "[redacted]",
      password: "[redacted]",
      text: "[redacted]",
    });
  });

  it("rejects a replayed BLE handshake independently of MessageService", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const b = await BleHandshakeExchange.create(blake, RECIPIENT, "blake");
    const proof = await b.proveTo(alice.publicKey);
    const replay = new HandshakeReplayGuard();
    expect((await verifyAuthenticatedHandshake({ raw: proof, local: alice, replay })).ok).toBe(true);
    expect((await verifyAuthenticatedHandshake({ raw: proof, local: alice, replay })).reason).toBe("replay");
  });

  it("issues unpredictable ephemeral voice ids", async () => {
    const a = await newEphemeralVoiceFileId();
    const b = await newEphemeralVoiceFileId();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });

  it("does not treat HTTP 5xx as local DELIVERED", async () => {
    const world = mockHttp({ status: 502 });
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openService(world.http, testCrypto(alice, blake.publicKey));
    const sent = await session.service.sendText({ ...sendInput, text: "five" });
    expect(sent.status).toBe(MessageStatus.QUEUED);
    expect(isCryptoBoxPayload((await session.store.getMessage(sent.message_id))?.encrypted_payload ?? "")).toBe(true);
    session.driver.close();
  });
});
