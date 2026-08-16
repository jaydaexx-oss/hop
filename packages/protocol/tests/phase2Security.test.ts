import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  decryptApplicationMessage,
  encryptApplicationMessage,
  generateIdentityKeyPair,
  identityPublishBody,
  type IdentityKeyPair,
  type MessageCrypto,
} from "../src/index.js";
import type { HopHttpClient } from "../src/http.js";
import { MessageStatus } from "../src/message.js";
import { MessageService } from "../src/messageService.js";
import { SqlJsDriver } from "../src/sqlJsDriver.js";
import { HopSqliteStore, type StoredMessage } from "../src/store.js";
import { PublicKeyTofu } from "../src/tofu.js";
import { TransportManager } from "../src/transportManager.js";
import { InternetTransport } from "../src/internetTransport.js";

const CONVO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SENDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECIPIENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function directedCrypto(self: IdentityKeyPair, peerKeys: Map<string, string>, tofu?: PublicKeyTofu): MessageCrypto {
  return {
    encrypt(plain) {
      const pk = peerKeys.get(plain.recipient_id);
      if (!pk) throw new Error("Peer has not published an identity public key.");
      if (tofu) {
        const state = tofu.observe(plain.recipient_id, pk);
        if (state === "KEY_CHANGED") throw new Error("Peer identity key changed; re-verify before sending");
      }
      return encryptApplicationMessage(plain, pk, self);
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

function mockHttp() {
  const posts: { message_id: string; encrypted_payload: string; status: string }[] = [];
  const http: HopHttpClient = {
    async request(path, init) {
      if (path === "/health") return { ok: true, status: 200, data: { status: "ok", service: "hop-api" } };
      if (init?.method === "POST" && path.endsWith("/messages")) {
        const body = init.body as { encrypted_payload: string; message_id: string };
        posts.push({
          message_id: body.message_id,
          encrypted_payload: body.encrypted_payload,
          status: "DELIVERED",
        });
        return {
          ok: true,
          status: 200,
          data: { message_id: body.message_id, encrypted_payload: body.encrypted_payload, status: "DELIVERED" },
        };
      }
      if (path.endsWith("/messages")) return { ok: true, status: 200, data: [] };
      return { ok: false, status: 404, data: null };
    },
  };
  return { http, posts };
}

const tmpDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hop-p2-"));
  tmpDirs.push(dir);
  return path.join(dir, "hop.db");
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

async function openAlice(
  file: string,
  alice: IdentityKeyPair,
  blake: IdentityKeyPair,
  tofu?: PublicKeyTofu,
) {
  const world = mockHttp();
  const driver = await SqlJsDriver.open(file);
  const store = new HopSqliteStore(driver);
  await store.init();
  await store.saveConversation({
    id: CONVO,
    peer_id: RECIPIENT,
    peer_username: "blake",
    peer_public_key: blake.publicKey,
    created_at: new Date().toISOString(),
  });
  const manager = new TransportManager();
  manager.register(new InternetTransport(world.http));
  const keys = new Map([[RECIPIENT, blake.publicKey]]);
  const service = new MessageService(
    store,
    manager,
    world.http,
    () => "token",
    directedCrypto(alice, keys, tofu),
    tofu,
  );
  return { driver, store, service, world };
}

describe("phase 2 cryptographic delivery and peer trust", () => {
  it("HTTP success / server DELIVERED cannot create local DELIVERED", async () => {
    const file = tempDb();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const session = await openAlice(file, alice, blake);
    const sent = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: SENDER,
      recipient_id: RECIPIENT,
      text: "hello",
    });
    expect(session.world.posts[0]?.status).toBe("DELIVERED");
    expect(sent.status).toBe(MessageStatus.SENT);
    const stored = await session.store.getMessage(sent.message_id);
    expect(stored?.status).toBe(MessageStatus.SENT);
    session.driver.close();
  });

  it("a valid recipient delivery_ack advances SENT to DELIVERED", async () => {
    const file = tempDb();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const tofu = new PublicKeyTofu();
    tofu.observe(RECIPIENT, blake.publicKey);
    const session = await openAlice(file, alice, blake, tofu);
    const sent = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: SENDER,
      recipient_id: RECIPIENT,
      text: "please ack",
    });
    expect(sent.status).toBe(MessageStatus.SENT);

    const ackId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const ackPlain = {
      message_id: ackId,
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
      message_id: ackId,
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
    const delivered = await session.store.getMessage(sent.message_id);
    expect(delivered?.status).toBe(MessageStatus.DELIVERED);
    const visible = await session.service.listMessages(CONVO);
    expect(visible).toHaveLength(1);
    expect(visible[0]?.status).toBe(MessageStatus.DELIVERED);
    session.driver.close();
  });

  it("rejects a forged delivery_ack from the wrong identity key", async () => {
    const file = tempDb();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const eve = await generateIdentityKeyPair();
    const tofu = new PublicKeyTofu();
    tofu.observe(RECIPIENT, blake.publicKey);
    const session = await openAlice(file, alice, blake, tofu);
    const sent = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: SENDER,
      recipient_id: RECIPIENT,
      text: "do not forge",
    });
    const ackId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const packed = await encryptApplicationMessage(
      {
        message_id: ackId,
        sender_id: RECIPIENT,
        recipient_id: SENDER,
        conversation_id: CONVO,
        text: "",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        ttl: 86_400_000,
        hop_count: 0,
        kind: "delivery_ack",
        ack_of: sent.message_id,
        ack_status: "DELIVERED",
      },
      alice.publicKey,
      eve,
    );
    const applied = await session.service.acceptInbound({
      message_id: ackId,
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
    });
    expect(applied).toBe(false);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.SENT);
    session.driver.close();
  });

  it("rejects a replayed delivery_ack message_id", async () => {
    const file = tempDb();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const tofu = new PublicKeyTofu();
    tofu.observe(RECIPIENT, blake.publicKey);
    const session = await openAlice(file, alice, blake, tofu);
    const sent = await session.service.sendText({
      conversation_id: CONVO,
      sender_id: SENDER,
      recipient_id: RECIPIENT,
      text: "replay me",
    });
    const ackId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const packed = await encryptApplicationMessage(
      {
        message_id: ackId,
        sender_id: RECIPIENT,
        recipient_id: SENDER,
        conversation_id: CONVO,
        text: "",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        ttl: 86_400_000,
        hop_count: 0,
        kind: "delivery_ack",
        ack_of: sent.message_id,
        ack_status: "DELIVERED",
      },
      alice.publicKey,
      blake,
    );
    const inbound: StoredMessage = {
      message_id: ackId,
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
    expect(await session.service.acceptInbound(inbound)).toBe(true);
    expect(await session.service.acceptInbound(inbound)).toBe(false);
    expect((await session.store.getMessage(sent.message_id))?.status).toBe(MessageStatus.DELIVERED);
    session.driver.close();
  });

  it("refuses to encrypt to a KEY_CHANGED peer", async () => {
    const file = tempDb();
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const mallory = await generateIdentityKeyPair();
    const tofu = new PublicKeyTofu();
    tofu.observe(RECIPIENT, blake.publicKey);
    expect(tofu.observe(RECIPIENT, mallory.publicKey)).toBe("KEY_CHANGED");
    const session = await openAlice(file, alice, mallory, tofu);
    await session.store.saveConversation({
      id: CONVO,
      peer_id: RECIPIENT,
      peer_username: "blake",
      peer_public_key: mallory.publicKey,
      created_at: new Date().toISOString(),
    });
    await expect(
      session.service.sendText({
        conversation_id: CONVO,
        sender_id: SENDER,
        recipient_id: RECIPIENT,
        text: "should not encrypt to the new key",
      }),
    ).rejects.toThrow(/key changed/i);
    expect(session.world.posts).toHaveLength(0);
    session.driver.close();
  });

  it("keeps existing crypto_box text working", async () => {
    const alice = await generateIdentityKeyPair();
    const blake = await generateIdentityKeyPair();
    const packed = await encryptApplicationMessage(
      {
        message_id: "11111111-1111-4111-8111-111111111111",
        sender_id: SENDER,
        recipient_id: RECIPIENT,
        conversation_id: CONVO,
        text: "still sealed",
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        ttl: 86_400_000,
        hop_count: 0,
      },
      blake.publicKey,
      alice,
    );
    const opened = await decryptApplicationMessage(packed, blake, alice.publicKey);
    expect(opened.text).toBe("still sealed");
    const body = identityPublishBody(alice.publicKey);
    expect(JSON.stringify(body)).not.toContain(alice.secretKey);
  });
});
