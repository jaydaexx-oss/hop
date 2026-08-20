import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CHATS_INBOX_SECTIONS,
  MessageStatus,
  canAcceptEventInvite,
  canCancelInvite,
  canDeclineEventInvite,
  canEndEvent,
  canInviteToEvent,
  canJoinDiscoverableEvent,
  canLeaveEvent,
  canRemoveGuest,
  chatsInboxSectionForKind,
  decryptApplicationMessage,
  discoverableDoesNotAutoJoin,
  encryptApplicationMessage,
  endingEventArchivesChat,
  eventChatCanRead,
  eventChatCanSend,
  eventChatFanoutRecipients,
  eventListSection,
  eventRowStatus,
  eventScheduleStatus,
  generateIdentityKeyPair,
  normalizeConversationKind,
  removedMemberLosesFutureEventChat,
  shouldApplyDirectInboxSafety,
  type IdentityKeyPair,
  type MessageCrypto,
} from "../src/index.js";
import type { HopHttpClient } from "../src/http.js";
import { MessageService } from "../src/messageService.js";
import { SqlJsDriver } from "../src/sqlJsDriver.js";
import { HopSqliteStore } from "../src/store.js";
import { TransportManager } from "../src/transportManager.js";

describe("conversation type separation", () => {
  it("keeps Direct, Events, and Groups as distinct inbox labels", () => {
    expect(CHATS_INBOX_SECTIONS).toEqual(["message_requests", "direct", "events"]);
    expect(chatsInboxSectionForKind("direct")).toBe("direct");
    expect(chatsInboxSectionForKind("event")).toBe("events");
    expect(chatsInboxSectionForKind(undefined)).toBe("direct");
    expect(normalizeConversationKind("event")).toBe("event");
    expect(normalizeConversationKind("group")).toBe("direct");
    expect(shouldApplyDirectInboxSafety("event")).toBe(false);
    expect(shouldApplyDirectInboxSafety("direct")).toBe(true);
    expect(CHATS_INBOX_SECTIONS.includes("groups" as never)).toBe(false);
  });
});

describe("event persistence and schedule", () => {
  it("does not treat radar/component state as the event source of truth", () => {
    const now = 1_000_000;
    expect(eventScheduleStatus({ startsAt: now - 10, endsAt: now + 10, now })).toBe("active");
    expect(eventScheduleStatus({ startsAt: now + 10, endsAt: now + 20, now })).toBe("upcoming");
    expect(eventScheduleStatus({ startsAt: now - 20, endsAt: now - 1, now })).toBe("ended");
    expect(eventScheduleStatus({ startsAt: now - 10, endsAt: now + 10, endedAt: now, now })).toBe("ended");
    expect(eventRowStatus({ schedule: "active", membership: "host" })).toBe("active");
    expect(eventRowStatus({ schedule: "upcoming", membership: "invited" })).toBe("invited");
    expect(eventRowStatus({ schedule: "ended", membership: "guest" })).toBe("ended");
    expect(eventListSection("active")).toBe("active");
    expect(eventListSection("invited")).toBe("upcoming");
    expect(eventListSection("ended")).toBe("past");
  });
});

describe("event invites and member control", () => {
  it("accepts and declines pending invites only", () => {
    expect(
      canAcceptEventInvite({ membership: "invited", inviteStatus: "pending", schedule: "upcoming" }),
    ).toBe(true);
    expect(
      canAcceptEventInvite({ membership: "guest", inviteStatus: "accepted", schedule: "active" }),
    ).toBe(false);
    expect(canDeclineEventInvite({ membership: "invited", inviteStatus: "pending" })).toBe(true);
    expect(canDeclineEventInvite({ membership: "guest", inviteStatus: "pending" })).toBe(false);
    expect(discoverableDoesNotAutoJoin()).toBe(true);
    expect(
      canJoinDiscoverableEvent({ visibility: "discoverable", membership: "none", schedule: "active" }),
    ).toBe(true);
    expect(
      canJoinDiscoverableEvent({ visibility: "invite_only", membership: "none", schedule: "active" }),
    ).toBe(false);
  });

  it("lets the host remove guests and cancel pending invites; guests can leave", () => {
    expect(canInviteToEvent({ actorRole: "host", schedule: "active" })).toBe(true);
    expect(canInviteToEvent({ actorRole: "guest", schedule: "active" })).toBe(false);
    expect(canCancelInvite({ actorRole: "host", inviteStatus: "pending" })).toBe(true);
    expect(canRemoveGuest({ actorRole: "host", targetRole: "guest" })).toBe(true);
    expect(canRemoveGuest({ actorRole: "guest", targetRole: "guest" })).toBe(false);
    expect(canRemoveGuest({ actorRole: "host", targetRole: "host" })).toBe(false);
    expect(canLeaveEvent({ actorRole: "guest" })).toBe(true);
    expect(canLeaveEvent({ actorRole: "host" })).toBe(false);
    expect(canEndEvent({ actorRole: "host", schedule: "active" })).toBe(true);
    expect(canEndEvent({ actorRole: "guest", schedule: "active" })).toBe(false);
    expect(removedMemberLosesFutureEventChat()).toBe(true);
  });
});

describe("event chat archive and fan-out", () => {
  it("archives chat on end and fans out to current members only", () => {
    expect(endingEventArchivesChat()).toBe(true);
    expect(eventChatCanSend({ membership: "guest", archived: false, schedule: "active" })).toBe(true);
    expect(eventChatCanSend({ membership: "guest", archived: true, schedule: "ended" })).toBe(false);
    expect(eventChatCanRead({ membership: "guest" })).toBe(true);
    expect(eventChatCanRead({ membership: "none" })).toBe(false);
    expect(eventChatFanoutRecipients(["host", "a", "b", "a", "host"], "host")).toEqual(["a", "b"]);
    expect(eventChatFanoutRecipients(["host"], "host")).toEqual([]);
  });
});

const tmpDirs: string[] = [];

function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "hop-events-"));
  tmpDirs.push(dir);
  return path.join(dir, "hop.db");
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function cryptoFor(self: IdentityKeyPair, keys: Record<string, string>): MessageCrypto {
  return {
    encrypt(plain) {
      const pk = keys[plain.recipient_id];
      if (!pk) throw new Error("missing recipient key");
      return encryptApplicationMessage(plain, pk, self);
    },
    sealLocal(plain) {
      return encryptApplicationMessage(plain, self.publicKey, self);
    },
    decrypt(payload, expectedSenderPk, expectedMessageId, options) {
      return decryptApplicationMessage(payload, self, expectedSenderPk, expectedMessageId, options);
    },
  };
}

describe("event chat persistence", () => {
  it("stores one local sealed copy and pairwise crypto_box copies per member", async () => {
    const alice = await generateIdentityKeyPair();
    const bob = await generateIdentityKeyPair();
    const cara = await generateIdentityKeyPair();
    const posted: unknown[] = [];
    const http: HopHttpClient = {
      async request(path, init) {
        if (init?.method === "POST" && String(path).endsWith("/messages")) {
          posted.push(init.body);
          return { ok: true, status: 200, data: { status: "SENT" } };
        }
        return { ok: false, status: 404, data: null };
      },
    };
    const driver = await SqlJsDriver.open(tempDb());
    const store = new HopSqliteStore(driver);
    await store.init();
    await store.saveConversation({
      id: "event-convo",
      peer_id: "host",
      peer_username: "Campus mixer",
      peer_public_key: alice.publicKey,
      created_at: new Date().toISOString(),
      kind: "event",
      title: "Campus mixer",
      event_id: "event-1",
      archived: false,
    });
    const service = new MessageService(
      store,
      new TransportManager(),
      http,
      () => "token",
      cryptoFor(alice, { bob: bob.publicKey, cara: cara.publicKey }),
    );
    const sent = await service.sendEventText({
      conversation_id: "event-convo",
      sender_id: "alice",
      recipient_ids: ["alice", "bob", "cara"],
      text: "see you there",
    });
    expect(sent.status).toBe(MessageStatus.SENT);
    expect(sent.text).toBe("see you there");
    const body = posted[0] as { copies: Array<{ recipient_id: string; encrypted_payload: string }> };
    expect(body.copies.map((copy) => copy.recipient_id).sort()).toEqual(["bob", "cara"]);
    for (const copy of body.copies) {
      expect(copy.encrypted_payload).toContain("crypto_box_xsalsa20poly1305");
      expect(copy.encrypted_payload).not.toContain("see you there");
    }
    const inbox = await service.listInbox("alice");
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.kind).toBe("event");
    expect(inbox[0]?.title).toBe("Campus mixer");
  });

  it("refuses to send after the event chat is archived", async () => {
    const alice = await generateIdentityKeyPair();
    const http: HopHttpClient = {
      async request() {
        return { ok: true, status: 200, data: {} };
      },
    };
    const driver = await SqlJsDriver.open(tempDb());
    const store = new HopSqliteStore(driver);
    await store.init();
    const service = new MessageService(store, new TransportManager(), http, () => "token", cryptoFor(alice, {}));
    await expect(
      service.sendEventText({
        conversation_id: "event-convo",
        sender_id: "alice",
        recipient_ids: ["bob"],
        text: "late",
        archived: true,
      }),
    ).rejects.toThrow(/archived/);
  });
});
