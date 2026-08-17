import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  SafetyError,
  SafetyService,
  bleDebugExposesHardwareId,
  decideInbound,
  decideOutbound,
  decideQrContact,
  deriveOperatingMode,
  eventEnabledAfterPrivacyChange,
  eventModeMayRun,
  operatingModeAfterEventExpiry,
  planOperatingMode,
  hopQrContainsSecrets,
  inboxVisibilityFor,
  inferRelationshipFromHistory,
  isBleDebugEnabled,
  isDiscoverableMode,
  privacyModeForDiscoverable,
  rememberDiscoverableMode,
  shouldNotifyFor,
  type PeerSafetyRecord,
} from "../src/index.js";
import {
  decryptApplicationMessage,
  encryptApplicationMessage,
  generateIdentityKeyPair,
  type IdentityKeyPair,
  type MessageCrypto,
} from "../src/index.js";
import type { HopHttpClient } from "../src/http.js";
import { InternetTransport } from "../src/internetTransport.js";
import { MessageService } from "../src/messageService.js";
import { SqlJsDriver } from "../src/sqlJsDriver.js";
import { HopSqliteStore } from "../src/store.js";
import { PublicKeyTofu } from "../src/tofu.js";
import type { EncryptedEnvelope, SendResult, Transport, TransportId } from "../src/transport.js";
import { TransportManager } from "../src/transportManager.js";

const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CONVO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function record(overrides: Partial<PeerSafetyRecord> = {}): PeerSafetyRecord {
  return {
    peerId: BOB,
    relationship: "none",
    muted: false,
    introMessageId: null,
    preBlockRelationship: null,
    updatedAt: "2026-08-17T00:00:00.000Z",
    ...overrides,
  };
}

function testCrypto(self: IdentityKeyPair, peerPk: string): MessageCrypto {
  return {
    encrypt(plain) {
      return encryptApplicationMessage(plain, peerPk, self);
    },
    sealLocal(plain) {
      return encryptApplicationMessage(plain, self.publicKey, self);
    },
    decrypt(payload, expectedSenderPk, expectedMessageId, options) {
      return decryptApplicationMessage(payload, self, expectedSenderPk, expectedMessageId, options);
    },
  };
}

function mockHttp() {
  const server = new Map<string, Record<string, unknown>>();
  const http: HopHttpClient = {
    async request(path, init) {
      if (path === "/health") return { ok: true, status: 200, data: { status: "ok" } };
      if (init?.method === "POST" && path.endsWith("/messages")) {
        const body = init.body as EncryptedEnvelope;
        const row = { ...body, status: "SENT", text: null };
        server.set(body.message_id, row);
        return { ok: true, status: 200, data: row };
      }
      if (path.includes("/conversations/") && path.endsWith("/messages")) {
        return { ok: true, status: 200, data: [...server.values()] };
      }
      return { ok: false, status: 404, data: null };
    },
  };
  return http;
}

function mockTransport(id: TransportId): Transport {
  return {
    id,
    async isAvailable() {
      return true;
    },
    async canSend() {
      return true;
    },
    async send(): Promise<SendResult> {
      return { ok: true, transport: id };
    },
    subscribe() {
      return () => undefined;
    },
    status() {
      return { id, available: true, implemented: true, detail: "mock" };
    },
  };
}

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

async function pair() {
  const dir = mkdtempSync(path.join(tmpdir(), "hop-safety-"));
  tmpDirs.push(dir);
  const aliceKeys = await generateIdentityKeyPair();
  const bobKeys = await generateIdentityKeyPair();
  async function open(self: IdentityKeyPair, peer: IdentityKeyPair, selfId: string, peerId: string) {
    const driver = await SqlJsDriver.open(path.join(dir, `${selfId}.db`));
    const store = new HopSqliteStore(driver);
    await store.init();
    await store.saveConversation({
      id: CONVO,
      peer_id: peerId,
      peer_username: "peer",
      peer_public_key: peer.publicKey,
      created_at: new Date().toISOString(),
    });
    await store.setSyncValue("self_user_id", selfId);
    const manager = new TransportManager();
    manager.register(new InternetTransport(mockHttp()));
    manager.register(mockTransport("local"));
    const tofu = new PublicKeyTofu();
    tofu.observe(peerId, peer.publicKey);
    const safety = new SafetyService(store);
    const service = new MessageService(
      store,
      manager,
      mockHttp(),
      () => "token",
      testCrypto(self, peer.publicKey),
      tofu,
    );
    service.attachSafety(safety);
    return { store, service, safety, self, peer };
  }
  const alice = await open(aliceKeys, bobKeys, ALICE, BOB);
  const bob = await open(bobKeys, aliceKeys, BOB, ALICE);
  return { alice, bob };
}

describe("safety policy", () => {
  it("turns unknown nearby contact into a message request, not a DM", () => {
    const outbound = decideOutbound(null);
    expect(outbound).toEqual({ allow: true, asRequest: true });
    expect(inboxVisibilityFor(null)).toBe("hidden");
    expect(inboxVisibilityFor(record({ relationship: "incoming_request" }))).toBe("request");
    expect(inboxVisibilityFor(record({ relationship: "accepted" }))).toBe("chat");
  });

  it("blocks a second introductory message until accept", () => {
    const pending = record({ relationship: "outgoing_request", introMessageId: "intro-1" });
    const second = decideOutbound(pending);
    expect(second.allow).toBe(false);
    if (!second.allow) expect(second.code).toBe("intro_limit");
  });

  it("accepts history including the original request", () => {
    expect(inferRelationshipFromHistory({ inboundCount: 1, outboundCount: 1 })).toBe("accepted");
    expect(inboxVisibilityFor(record({ relationship: "accepted" }))).toBe("chat");
  });

  it("declines hide the request and refuse further send", () => {
    const declined = record({ relationship: "declined" });
    expect(decideOutbound(declined).allow).toBe(false);
    expect(decideInbound(declined).allow).toBe(false);
    expect(inboxVisibilityFor(declined)).toBe("hidden");
  });

  it("block overrides BLE, internet, requests, and QR", () => {
    const blocked = record({ relationship: "blocked" });
    expect(decideOutbound(blocked).allow).toBe(false);
    expect(decideInbound(blocked).allow).toBe(false);
    expect(decideQrContact(blocked).allow).toBe(false);
    expect(inboxVisibilityFor(blocked)).toBe("hidden");
  });

  it("unmute/unblock restore independently of mute", () => {
    const muted = record({ relationship: "accepted", muted: true });
    expect(decideOutbound(muted).allow).toBe(true);
    expect(decideInbound(muted).allow).toBe(true);
    expect(shouldNotifyFor(muted)).toBe(false);
    expect(shouldNotifyFor(record({ relationship: "accepted", muted: false }))).toBe(true);
  });

  it("Discoverable OFF is Invisible and Event Mode cannot override it", () => {
    expect(isDiscoverableMode("invisible")).toBe(false);
    expect(isDiscoverableMode("everyone")).toBe(true);
    expect(privacyModeForDiscoverable(false, "everyone")).toBe("invisible");
    expect(privacyModeForDiscoverable(true, "contacts")).toBe("contacts");
    expect(rememberDiscoverableMode("invisible", "contacts")).toBe("contacts");
    expect(eventModeMayRun("invisible")).toBe(false);
    expect(eventModeMayRun("everyone")).toBe(true);
    expect(eventEnabledAfterPrivacyChange("invisible", true)).toBe(false);
    expect(deriveOperatingMode("invisible", true)).toBe("invisible");
  });

  it("derives the 3-mode Nearby experience from privacyMode + eventMode", () => {
    expect(deriveOperatingMode("invisible", false)).toBe("invisible");
    expect(deriveOperatingMode("contacts", false)).toBe("around_us");
    expect(deriveOperatingMode("everyone", false)).toBe("around_us");
    expect(deriveOperatingMode("contacts", true)).toBe("event");
    expect(deriveOperatingMode("everyone", true)).toBe("event");
    expect(deriveOperatingMode("invisible", true)).toBe("invisible");
    expect(operatingModeAfterEventExpiry("everyone")).toBe("around_us");
    expect(operatingModeAfterEventExpiry("contacts")).toBe("around_us");
    expect(operatingModeAfterEventExpiry("invisible")).toBe("invisible");
  });

  it("refuses Event Mode while Invisible until an audience is chosen", () => {
    const blocked = planOperatingMode({
      target: "event",
      privacyMode: "invisible",
      lastDiscoverableMode: "everyone",
      eventEnabled: false,
    });
    expect(blocked.blockedByInvisible).toBe(true);
    expect(blocked.nextPrivacyMode).toBe("invisible");
    expect(blocked.nextEventEnabled).toBe(false);
    expect(eventModeMayRun("invisible")).toBe(false);

    const consented = planOperatingMode({
      target: "event",
      privacyMode: "invisible",
      lastDiscoverableMode: "everyone",
      eventEnabled: false,
      audience: "contacts",
    });
    expect(consented.blockedByInvisible).toBe(false);
    expect(consented.nextPrivacyMode).toBe("contacts");
    expect(consented.nextEventEnabled).toBe(true);

    const kill = planOperatingMode({
      target: "invisible",
      privacyMode: "everyone",
      lastDiscoverableMode: "everyone",
      eventEnabled: true,
    });
    expect(kill.nextPrivacyMode).toBe("invisible");
    expect(kill.nextEventEnabled).toBe(false);
    expect(kill.lastDiscoverableMode).toBe("everyone");

    const afterExpiry = planOperatingMode({
      target: "around_us",
      privacyMode: "everyone",
      lastDiscoverableMode: "everyone",
      eventEnabled: true,
    });
    expect(afterExpiry.nextPrivacyMode).toBe("everyone");
    expect(afterExpiry.nextEventEnabled).toBe(false);
    expect(deriveOperatingMode(afterExpiry.nextPrivacyMode, afterExpiry.nextEventEnabled)).toBe(
      "around_us",
    );
  });

  it("BLE debug is gated to __DEV__ and never exposes hardware IDs", () => {
    expect(isBleDebugEnabled(true)).toBe(true);
    expect(isBleDebugEnabled(false)).toBe(false);
    expect(bleDebugExposesHardwareId()).toBe(false);
  });
});

describe("SafetyService persistence", () => {
  it("persists block, mute, report, and discoverable-independent requests", async () => {
    const driver = await SqlJsDriver.open();
    const store = new HopSqliteStore(driver);
    await store.init();
    const safety = new SafetyService(store);
    await safety.recordInboundIntro(BOB, "msg-1");
    expect((await safety.get(BOB))?.relationship).toBe("incoming_request");
    await safety.markAccepted(BOB);
    expect((await safety.get(BOB))?.relationship).toBe("accepted");
    await safety.setMuted(BOB, true);
    expect(await safety.isMuted(BOB)).toBe(true);
    expect((await safety.get(BOB))?.relationship).toBe("accepted");
    const report = await safety.report(BOB, "spam", "unsolicited");
    expect(report.category).toBe("spam");
    expect(report.note).toBe("unsolicited");
    expect(JSON.stringify(report)).not.toMatch(/hello there secret/i);
    await safety.block(BOB);
    expect(await safety.isBlocked(BOB)).toBe(true);
    await safety.unblock(BOB);
    expect((await safety.get(BOB))?.relationship).toBe("accepted");
    expect(await safety.isMuted(BOB)).toBe(true);
  });

  it("grandfathers two-way history as accepted", async () => {
    const driver = await SqlJsDriver.open();
    const store = new HopSqliteStore(driver);
    await store.init();
    await store.saveConversation({
      id: CONVO,
      peer_id: BOB,
      peer_username: "bob",
      peer_public_key: "pk",
      created_at: "2026-08-01T00:00:00.000Z",
    });
    await store.saveMessage({
      message_id: "m1",
      conversation_id: CONVO,
      sender_id: ALICE,
      recipient_id: BOB,
      text: null,
      encrypted_payload: "box",
      status: "SENT",
      transport: "internet",
      created_at: "2026-08-01T00:00:00.000Z",
      expires_at: "2026-08-08T00:00:00.000Z",
      ttl: 1,
      hop_count: 0,
      kind: "message",
    });
    await store.saveMessage({
      message_id: "m2",
      conversation_id: CONVO,
      sender_id: BOB,
      recipient_id: ALICE,
      text: null,
      encrypted_payload: "box",
      status: "DELIVERED",
      transport: "internet",
      created_at: "2026-08-01T00:01:00.000Z",
      expires_at: "2026-08-08T00:00:00.000Z",
      ttl: 1,
      hop_count: 0,
      kind: "message",
    });
    const safety = new SafetyService(store);
    await safety.hydrate(ALICE);
    expect((await safety.get(BOB))?.relationship).toBe("accepted");
  });
});

describe("message request lifecycle with MessageService", () => {
  it("unknown sender intro is a request; second intro is dropped; accept keeps history", async () => {
    const { alice, bob } = await pair();
    const intro = await alice.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE,
      recipient_id: BOB,
      text: "hi from nearby",
    });
    expect((await alice.safety.get(BOB))?.relationship).toBe("outgoing_request");
    await expect(
      alice.service.sendText({
        conversation_id: CONVO,
        sender_id: ALICE,
        recipient_id: BOB,
        text: "spam follow-up",
      }),
    ).rejects.toBeInstanceOf(SafetyError);

    const aliceInbox = await alice.service.listInbox(ALICE);
    expect(aliceInbox.find((row) => row.id === CONVO)).toBeUndefined();

    const stored = await alice.store.getMessage(intro.message_id);
    expect(stored).toBeTruthy();
    const delivered = await bob.service.acceptInbound({
      ...stored!,
      text: null,
      status: "SENT",
    });
    expect(delivered).toBe(true);
    expect((await bob.safety.get(ALICE))?.relationship).toBe("incoming_request");
    const bobInbox = await bob.service.listInbox(BOB);
    expect(bobInbox.find((row) => row.id === CONVO)).toBeUndefined();

    const second = await alice.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE,
      recipient_id: BOB,
      text: "another try",
    }).catch((err) => err);
    expect(second).toBeInstanceOf(SafetyError);

    const dup = await alice.store.getMessage(intro.message_id);
    const ignored = await bob.service.acceptInbound({
      ...dup!,
      message_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      text: null,
      encrypted_payload: stored!.encrypted_payload,
    });
    expect(ignored).toBe(false);

    alice.service.attachSafety(null);
    const spam = await alice.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE,
      recipient_id: BOB,
      text: "forged second intro",
    });
    alice.service.attachSafety(alice.safety);
    const spamStored = await alice.store.getMessage(spam.message_id);
    expect(await bob.service.acceptInbound({ ...spamStored!, text: null })).toBe(false);

    await bob.safety.markAccepted(ALICE);
    expect((await bob.safety.get(ALICE))?.relationship).toBe("accepted");
    const after = await bob.service.listInbox(BOB);
    expect(after.some((row) => row.id === CONVO)).toBe(true);
    const history = await bob.store.listMessages(CONVO);
    expect(history.some((row) => row.message_id === intro.message_id)).toBe(true);

    const reply = await bob.service.sendText({
      conversation_id: CONVO,
      sender_id: BOB,
      recipient_id: ALICE,
      text: "accepted, let's chat",
    });
    const replyStored = await bob.store.getMessage(reply.message_id);
    expect(await alice.service.acceptInbound({ ...replyStored!, text: null })).toBe(true);
    expect((await alice.safety.get(BOB))?.relationship).toBe("accepted");
    const follow = await alice.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE,
      recipient_id: BOB,
      text: "normal chat now",
    });
    expect(follow.message_id).not.toBe(intro.message_id);
  });

  it("decline rejects further messages", async () => {
    const { alice, bob } = await pair();
    const intro = await alice.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE,
      recipient_id: BOB,
      text: "please chat",
    });
    const stored = await alice.store.getMessage(intro.message_id);
    await bob.service.acceptInbound({ ...stored!, text: null });
    await bob.safety.decline(ALICE);
    const again = await bob.service.acceptInbound({
      ...stored!,
      message_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      text: null,
    });
    expect(again).toBe(false);
    await expect(
      alice.service.sendText({
        conversation_id: CONVO,
        sender_id: ALICE,
        recipient_id: BOB,
        text: "after decline",
      }),
    ).rejects.toBeInstanceOf(SafetyError);
  });

  it("block overrides send and inbound; unblock restores", async () => {
    const { alice, bob } = await pair();
    await alice.safety.markAccepted(BOB);
    await bob.safety.markAccepted(ALICE);
    await alice.safety.block(BOB);
    await expect(
      alice.service.sendText({
        conversation_id: CONVO,
        sender_id: ALICE,
        recipient_id: BOB,
        text: "nope",
      }),
    ).rejects.toMatchObject({ code: "blocked" });
    const fromBob = await bob.service.sendText({
      conversation_id: CONVO,
      sender_id: BOB,
      recipient_id: ALICE,
      text: "hello blocked side",
    });
    const stored = await bob.store.getMessage(fromBob.message_id);
    expect(await alice.service.acceptInbound({ ...stored!, text: null })).toBe(false);
    await alice.safety.unblock(BOB);
    const after = await bob.service.sendText({
      conversation_id: CONVO,
      sender_id: BOB,
      recipient_id: ALICE,
      text: "after unblock",
    });
    const stored2 = await bob.store.getMessage(after.message_id);
    expect(await alice.service.acceptInbound({ ...stored2!, text: null })).toBe(true);
  });

  it("mute still delivers and keeps the conversation; report does not block", async () => {
    const { alice, bob } = await pair();
    await alice.safety.markAccepted(BOB);
    await bob.safety.markAccepted(ALICE);
    await alice.safety.setMuted(BOB, true);
    const sent = await bob.service.sendText({
      conversation_id: CONVO,
      sender_id: BOB,
      recipient_id: ALICE,
      text: "muted ping",
    });
    const stored = await bob.store.getMessage(sent.message_id);
    expect(await alice.service.acceptInbound({ ...stored!, text: null })).toBe(true);
    expect(await alice.safety.shouldNotify(BOB)).toBe(false);
    const inbox = await alice.service.listInbox(ALICE);
    expect(inbox.some((row) => row.id === CONVO)).toBe(true);
    await alice.safety.report(BOB, "harassment");
    expect(await alice.safety.isBlocked(BOB)).toBe(false);
    const reply = await alice.service.sendText({
      conversation_id: CONVO,
      sender_id: ALICE,
      recipient_id: BOB,
      text: "still chatting",
    });
    expect(reply).toBeTruthy();
  });

  it("forged or unknown sender cannot bypass block or intro limit", async () => {
    const { alice, bob } = await pair();
    await alice.safety.block(BOB);
    const forged = await bob.service.sendText({
      conversation_id: CONVO,
      sender_id: BOB,
      recipient_id: ALICE,
      text: "forged",
    });
    const stored = await bob.store.getMessage(forged.message_id);
    expect(await alice.service.acceptInbound({ ...stored!, text: null })).toBe(false);
    expect(hopQrContainsSecrets("hop://u/bob?i=hdeadbeefaa")).toBe(false);
  });
});
