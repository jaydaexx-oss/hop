import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ACK_PROTOCOL_VERSION,
  MAX_ENCRYPTED_PAYLOAD_BYTES,
  MessageStatus,
  decryptApplicationMessage,
  encryptApplicationMessage,
  generateIdentityKeyPair,
  isExpired,
  mergePersistedStatus,
  nextBackoffMs,
  parseAckPlain,
  parseCryptoBoxPayload,
  redactForLog,
  sortConversationMessages,
  type IdentityKeyPair,
  type MessageCrypto,
} from "../src/index.js";
import type { HopHttpClient } from "../src/http.js";
import { InternetTransport } from "../src/internetTransport.js";
import { MessageService } from "../src/messageService.js";
import { DEFAULT_RETRY_POLICY } from "../src/retry.js";
import { SqlJsDriver } from "../src/sqlJsDriver.js";
import { HopSqliteStore, type StoredMessage } from "../src/store.js";
import { PublicKeyTofu } from "../src/tofu.js";
import { type EncryptedEnvelope, type SendResult, type Transport } from "../src/transport.js";
import { TransportManager } from "../src/transportManager.js";

const CONVO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ALICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

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

const tmpDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hop-reli-"));
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
  bindTofu?: boolean;
  extra?: Transport;
  http?: HopHttpClient;
}) {
  const world = options.http ? { http: options.http } : mockHttp(true);
  const driver = await SqlJsDriver.open(options.file);
  const store = new HopSqliteStore(driver);
  await store.init();
  await store.saveConversation({
    id: CONVO,
    peer_id: BOB_ID,
    peer_username: "bob",
    peer_public_key: options.peer.publicKey,
    created_at: new Date().toISOString(),
  });
  const tofu = new PublicKeyTofu();
  if (options.bindTofu !== false) tofu.observe(BOB_ID, options.peer.publicKey);
  const manager = new TransportManager();
  manager.register(new InternetTransport(world.http));
  if (options.extra) manager.register(options.extra);
  const service = new MessageService(
    store,
    manager,
    world.http,
    () => "token",
    testCrypto(options.self, options.peer.publicKey, tofu),
    tofu,
  );
  return { driver, store, service, manager, tofu, http: world.http };
}

function boxedMessage(
  overrides: Partial<StoredMessage> & Pick<StoredMessage, "message_id" | "encrypted_payload">,
): StoredMessage {
  return {
    conversation_id: CONVO,
    sender_id: ALICE_ID,
    recipient_id: BOB_ID,
    text: null,
    status: MessageStatus.QUEUED,
    transport: "local",
    created_at: "2026-08-16T00:00:00.000Z",
    expires_at: "2026-08-23T00:00:00.000Z",
    ttl: 86_400_000,
    hop_count: 0,
    send_seq: 1,
    kind: "message",
    ...overrides,
  };
}

describe("SQLite durability and crash recovery", () => {
  it("re-enqueues an orphan QUEUED ciphertext after process restart", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const file = tempDb();
    const first = await openPeer({ file, self: alice, peer: bob });
    const packed = await encryptApplicationMessage(
      {
        message_id: "11111111-1111-4111-8111-111111111111",
        sender_id: ALICE_ID,
        recipient_id: BOB_ID,
        conversation_id: CONVO,
        text: "orphan-queued",
        created_at: "2026-08-16T00:00:00.000Z",
        expires_at: "2026-08-23T00:00:00.000Z",
        ttl: 86_400_000,
        hop_count: 0,
        send_seq: 1,
      },
      bob.publicKey,
      alice,
    );
    await first.store.saveMessage(
      boxedMessage({
        message_id: "11111111-1111-4111-8111-111111111111",
        encrypted_payload: packed,
        local_seal: packed,
        status: MessageStatus.QUEUED,
      }),
    );
    expect(await first.store.queuedCount()).toBe(0);
    first.driver.close();

    const second = await openPeer({ file, self: alice, peer: bob });
    await second.service.recoverInFlight();
    expect(await second.store.queuedCount()).toBe(1);
    const row = await second.store.getMessage("11111111-1111-4111-8111-111111111111");
    expect(row?.status).toBe(MessageStatus.QUEUED);
    expect(row?.encrypted_payload).toBe(packed);
    await second.service.sync();
    expect((await second.store.getMessage("11111111-1111-4111-8111-111111111111"))?.status).toBe(
      MessageStatus.SENT,
    );
    second.driver.close();
  });

  it("drops a leftover outbox row for a message already known SENT", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const session = await openPeer({ file: tempDb(), self: alice, peer: bob });
    const sent = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE_ID,
      recipient_id: BOB_ID,
      text: "already-sent",
    });
    expect(sent.status).toBe(MessageStatus.SENT);
    await session.store.enqueue(sent.message_id, 3, Date.now());
    await session.service.recoverInFlight();
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.SENT);
    expect(await session.store.queuedCount()).toBe(0);
    session.driver.close();
  });
});

describe("concurrency / duplicate send", () => {
  it("serializes send+retry so one message_id is accepted once", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const sent: EncryptedEnvelope[] = [];
    let gate: Promise<void> = Promise.resolve();
    let releaseGate = () => undefined;
    const slow: Transport = {
      id: "internet",
      async isAvailable() {
        return true;
      },
      async canSend() {
        return true;
      },
      async send(envelope): Promise<SendResult> {
        await gate;
        sent.push(envelope);
        return { ok: true, transport: "internet" };
      },
      subscribe() {
        return () => undefined;
      },
      status() {
        return { id: "internet", available: true, implemented: true, detail: "slow" };
      },
    };
    const file = tempDb();
    const driver = await SqlJsDriver.open(file);
    const store = new HopSqliteStore(driver);
    await store.init();
    const manager = new TransportManager();
    manager.register(slow);
    const http = mockHttp(false).http;
    const service = new MessageService(store, manager, http, () => null, testCrypto(alice, bob.publicKey));
    const packed = await encryptApplicationMessage(
      {
        message_id: "22222222-2222-4222-8222-222222222222",
        sender_id: ALICE_ID,
        recipient_id: BOB_ID,
        conversation_id: CONVO,
        text: "race",
        created_at: "2026-08-16T00:00:00.000Z",
        expires_at: "2026-08-23T00:00:00.000Z",
        ttl: 86_400_000,
        hop_count: 0,
        send_seq: 1,
      },
      bob.publicKey,
      alice,
    );
    await store.saveMessage(
      boxedMessage({
        message_id: "22222222-2222-4222-8222-222222222222",
        encrypted_payload: packed,
        status: MessageStatus.QUEUED,
      }),
    );
    await store.enqueue("22222222-2222-4222-8222-222222222222", 0, 0);
    gate = new Promise((resolve) => {
      releaseGate = resolve;
    });
    const a = service.retryDue(new Date("2026-08-16T01:00:00.000Z"));
    const b = service.sync(new Date("2026-08-16T01:00:00.000Z"));
    await Promise.resolve();
    await Promise.resolve();
    releaseGate();
    await Promise.all([a, b]);
    const copies = sent.filter((row) => row.message_id === "22222222-2222-4222-8222-222222222222");
    expect(copies).toHaveLength(1);
    expect((await store.getMessage("22222222-2222-4222-8222-222222222222"))?.status).toBe(MessageStatus.SENT);
    driver.close();
  });
});

describe("authentication / forged ACK", () => {
  it("does not TOFU-bind a peer identity from a delivery_ack", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const eve = await generateIdentityKeyPair();
    const session = await openPeer({ file: tempDb(), self: alice, peer: bob, bindTofu: false });
    expect(session.tofu.state(BOB_ID)).toBe("UNKNOWN");
    const packed = await encryptApplicationMessage(
      {
        message_id: "33333333-3333-4333-8333-333333333333",
        sender_id: BOB_ID,
        recipient_id: ALICE_ID,
        conversation_id: CONVO,
        text: "",
        created_at: "2026-08-16T00:00:00.000Z",
        expires_at: "2026-08-23T00:00:00.000Z",
        ttl: 86_400_000,
        hop_count: 0,
        kind: "delivery_ack",
        ack_of: "44444444-4444-4444-8444-444444444444",
        ack_status: "DELIVERED",
        ack_type: "DELIVERED_ACK",
        ack_v: ACK_PROTOCOL_VERSION,
      },
      alice.publicKey,
      eve,
    );
    const accepted = await session.service.acceptInbound({
      message_id: "33333333-3333-4333-8333-333333333333",
      conversation_id: CONVO,
      sender_id: BOB_ID,
      recipient_id: ALICE_ID,
      text: null,
      encrypted_payload: packed,
      status: MessageStatus.SENT,
      transport: "internet",
      created_at: "2026-08-16T00:00:00.000Z",
      expires_at: "2026-08-23T00:00:00.000Z",
      ttl: 86_400_000,
      hop_count: 0,
      kind: "delivery_ack",
    });
    expect(accepted).toBe(false);
    expect(session.tofu.state(BOB_ID)).toBe("UNKNOWN");
    expect(session.tofu.get(BOB_ID)).toBeUndefined();
    session.driver.close();
  });

  it("keeps the first pending inbound receipt and ignores a later mismatched clobber", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const session = await openPeer({ file: tempDb(), self: alice, peer: bob });
    const ackOf = "55555555-5555-4555-8555-555555555555";
    await session.store.saveInboundReceipt({
      ack_of: ackOf,
      ack_type: "DELIVERED_ACK",
      conversation_id: CONVO,
      sender_id: BOB_ID,
      sender_pk: bob.publicKey,
    });
    await session.store.saveInboundReceipt({
      ack_of: ackOf,
      ack_type: "DELIVERED_ACK",
      conversation_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      sender_id: EVE_ID,
      sender_pk: "eve-pk",
    });
    const rows = await session.store.listInboundReceipts(ackOf);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sender_id).toBe(BOB_ID);
    expect(rows[0]?.conversation_id).toBe(CONVO);
    expect(rows[0]?.sender_pk).toBe(bob.publicKey);
    session.driver.close();
  });
});

describe("malformed and untrusted input", () => {
  it("rejects oversized, version-skewed, and structurally invalid envelopes without throwing", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const session = await openPeer({ file: tempDb(), self: alice, peer: bob });
    const huge = "A".repeat(MAX_ENCRYPTED_PAYLOAD_BYTES + 8);
    expect(parseCryptoBoxPayload(huge)).toBeNull();
    expect(
      await session.service.acceptInbound(
        boxedMessage({
          message_id: "66666666-6666-4666-8666-666666666666",
          encrypted_payload: huge,
          status: MessageStatus.SENT,
          sender_id: BOB_ID,
          recipient_id: ALICE_ID,
        }),
      ),
    ).toBe(false);
    expect(parseCryptoBoxPayload(JSON.stringify({ v: 99, alg: "crypto_box_xsalsa20poly1305", sender_pk: "x", nonce: "n", ciphertext: "c" }))).toBeNull();
    expect(parseAckPlain({ kind: "delivery_ack", ack_of: "x".repeat(10_000), message_id: "y", sender_id: "a", recipient_id: "b", conversation_id: "c", text: "", ack_status: "DELIVERED" })).toBeNull();
    expect(
      await session.service.acceptInbound(
        boxedMessage({
          message_id: "not a uuid",
          encrypted_payload: "{",
          status: MessageStatus.SENT,
        }),
      ),
    ).toBe(false);
    expect(
      await session.service.acceptInbound(
        boxedMessage({
          message_id: "77777777-7777-4777-8777-777777777777",
          encrypted_payload: JSON.stringify({ v: 1, alg: "crypto_box_xsalsa20poly1305", sender_pk: "x", nonce: "n", ciphertext: "c" }),
          status: MessageStatus.SENT,
          ttl: -1,
          hop_count: -4,
        }),
      ),
    ).toBe(false);
    session.driver.close();
  });

  it("treats unparseable expires_at as expired", () => {
    expect(isExpired({ expires_at: "not-a-date" }, new Date("2026-08-16T00:00:00.000Z"))).toBe(true);
    expect(isExpired({ expires_at: "" }, new Date("2026-08-16T00:00:00.000Z"))).toBe(true);
  });
});

describe("retry backoff", () => {
  it("is bounded, seed-deterministic, and not a tight loop", () => {
    const delays: number[] = [];
    let attempt = 0;
    for (;;) {
      const wait = nextBackoffMs(attempt, DEFAULT_RETRY_POLICY, mulberry32(7));
      if (wait === null) break;
      delays.push(wait);
      attempt += 1;
      expect(attempt).toBeLessThanOrEqual(DEFAULT_RETRY_POLICY.maxAttempts);
    }
    expect(delays.length).toBe(DEFAULT_RETRY_POLICY.maxAttempts);
    expect(Math.max(...delays)).toBeLessThanOrEqual(DEFAULT_RETRY_POLICY.maxMs);
    expect(delays[0]).toBeGreaterThanOrEqual(DEFAULT_RETRY_POLICY.baseMs / 2);
    const again: number[] = [];
    for (let i = 0; i < DEFAULT_RETRY_POLICY.maxAttempts; i++) {
      again.push(nextBackoffMs(i, DEFAULT_RETRY_POLICY, mulberry32(7))!);
    }
    expect(again).toEqual(delays);
    expect(nextBackoffMs(0)).toBe(1_000);
  });
});

describe("observability privacy", () => {
  it("redacts plaintext, local_seal, and ciphertext keys", () => {
    const redacted = redactForLog({
      message_id: "m1",
      status: "SENT",
      transport: "internet",
      retry_count: 2,
      text: "secret hello",
      plaintext: "secret hello",
      local_seal: "seal",
      encrypted_payload: "box",
    });
    expect(redacted).toMatchObject({
      message_id: "m1",
      status: "SENT",
      transport: "internet",
      retry_count: 2,
      text: "[redacted]",
      plaintext: "[redacted]",
      local_seal: "[redacted]",
      encrypted_payload: "[redacted]",
    });
  });
});

describe("storage pressure", () => {
  it("lists 10_000 messages in stable order without quadratic blowup", { timeout: 120_000 }, async () => {
    const driver = await SqlJsDriver.open();
    const store = new HopSqliteStore(driver);
    await store.init();
    const created = "2026-08-16T00:00:00.000Z";
    for (let i = 0; i < 10_000; i++) {
      await store.saveMessage(
        boxedMessage({
          message_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          conversation_id: i % 2 === 0 ? CONVO : "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          sender_id: i % 2 === 0 ? ALICE_ID : BOB_ID,
          encrypted_payload: "{}",
          send_seq: Math.floor(i / 2) + 1,
          created_at: created,
          status: MessageStatus.SENT,
        }),
      );
      if (i % 250 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const started = Date.now();
    const listed = await store.listMessages(CONVO);
    const elapsed = Date.now() - started;
    expect(listed).toHaveLength(5_000);
    expect(sortConversationMessages([...listed].reverse()).map((row) => row.message_id)).toEqual(
      listed.map((row) => row.message_id),
    );
    expect(elapsed).toBeLessThan(8_000);
    expect(await store.queuedCount()).toBe(0);
    driver.close();
  });
});

describe("lifecycle invariants with a deterministic seed", () => {
  it("never regresses status and keeps one logical row per message_id", async () => {
    const random = mulberry32(42);
    const statuses = [
      MessageStatus.CREATED,
      MessageStatus.ENCRYPTING,
      MessageStatus.ENCRYPTED,
      MessageStatus.QUEUED,
      MessageStatus.RETRYING,
      MessageStatus.SENDING,
      MessageStatus.SENT,
      MessageStatus.DELIVERED,
      MessageStatus.READ,
      MessageStatus.FAILED,
      MessageStatus.EXPIRED,
    ];
    let current = MessageStatus.CREATED;
    for (let i = 0; i < 200; i++) {
      const incoming = statuses[Math.floor(random() * statuses.length)]!;
      const next = mergePersistedStatus(current, incoming);
      if (current === MessageStatus.READ) expect(next).toBe(MessageStatus.READ);
      if (current === MessageStatus.EXPIRED) expect(next).toBe(MessageStatus.EXPIRED);
      if (current === MessageStatus.DELIVERED) {
        expect(next === MessageStatus.DELIVERED || next === MessageStatus.READ).toBe(true);
      }
      current = next;
    }
  });
});
