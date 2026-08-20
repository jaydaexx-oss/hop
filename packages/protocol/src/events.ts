/** First-class HOP Events. Radar Event Mode is activation, not the event store. */

export const CONVERSATION_KINDS = ["direct", "event"] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

export const EVENT_VISIBILITIES = ["invite_only", "discoverable"] as const;
export type EventVisibility = (typeof EVENT_VISIBILITIES)[number];

export const EVENT_MEMBER_ROLES = ["host", "guest"] as const;
export type EventMemberRole = (typeof EVENT_MEMBER_ROLES)[number];

export const EVENT_INVITE_STATUSES = ["pending", "accepted", "declined", "cancelled"] as const;
export type EventInviteStatus = (typeof EVENT_INVITE_STATUSES)[number];

export const EVENT_SCHEDULE_STATUSES = ["upcoming", "active", "ended"] as const;
export type EventScheduleStatus = (typeof EVENT_SCHEDULE_STATUSES)[number];

export const EVENT_ROW_STATUSES = ["active", "upcoming", "invited", "ended"] as const;
export type EventRowStatus = (typeof EVENT_ROW_STATUSES)[number];

export const CHATS_INBOX_SECTIONS = ["message_requests", "direct", "events"] as const;
export type ChatsInboxSectionId = (typeof CHATS_INBOX_SECTIONS)[number];

export const MAX_EVENT_MEMBERS = 32;
export const MAX_EVENT_PENDING_INVITES = 32;
export const MAX_EVENT_START_AHEAD_MS = 30 * 24 * 60 * 60 * 1000;

export type EventMembershipView = EventMemberRole | "invited" | "none";

export function normalizeConversationKind(raw: string | null | undefined): ConversationKind {
  return raw === "event" ? "event" : "direct";
}

export function chatsInboxSectionForKind(kind: ConversationKind | string | null | undefined): Exclude<
  ChatsInboxSectionId,
  "message_requests"
> {
  return normalizeConversationKind(kind) === "event" ? "events" : "direct";
}

export function shouldApplyDirectInboxSafety(kind: ConversationKind | string | null | undefined): boolean {
  return normalizeConversationKind(kind) !== "event";
}

export function eventScheduleStatus(input: {
  startsAt: number;
  endsAt: number;
  endedAt?: number | null;
  now: number;
}): EventScheduleStatus {
  if (input.endedAt != null && input.endedAt <= input.now) return "ended";
  if (input.endsAt <= input.now) return "ended";
  if (input.startsAt > input.now) return "upcoming";
  return "active";
}

export function eventRowStatus(input: {
  schedule: EventScheduleStatus;
  membership: EventMembershipView;
}): EventRowStatus {
  if (input.schedule === "ended") return "ended";
  if (input.membership === "invited") return "invited";
  if (input.schedule === "upcoming") return "upcoming";
  return "active";
}

export function eventListSection(status: EventRowStatus): "active" | "upcoming" | "past" {
  if (status === "ended") return "past";
  if (status === "upcoming" || status === "invited") return "upcoming";
  return "active";
}

export function canInviteToEvent(input: {
  actorRole: EventMembershipView;
  schedule: EventScheduleStatus;
}): boolean {
  return input.actorRole === "host" && input.schedule !== "ended";
}

export function canCancelInvite(input: {
  actorRole: EventMembershipView;
  inviteStatus: EventInviteStatus;
}): boolean {
  return input.actorRole === "host" && input.inviteStatus === "pending";
}

export function canRemoveGuest(input: {
  actorRole: EventMembershipView;
  targetRole: EventMembershipView;
}): boolean {
  return input.actorRole === "host" && input.targetRole === "guest";
}

export function canLeaveEvent(input: { actorRole: EventMembershipView }): boolean {
  return input.actorRole === "guest";
}

export function canEndEvent(input: { actorRole: EventMembershipView; schedule: EventScheduleStatus }): boolean {
  return input.actorRole === "host" && input.schedule !== "ended";
}

export function canJoinDiscoverableEvent(input: {
  visibility: EventVisibility;
  membership: EventMembershipView;
  schedule: EventScheduleStatus;
}): boolean {
  return (
    input.visibility === "discoverable" &&
    input.schedule === "active" &&
    input.membership === "none"
  );
}

export function canAcceptEventInvite(input: {
  membership: EventMembershipView;
  inviteStatus: EventInviteStatus;
  schedule: EventScheduleStatus;
}): boolean {
  return input.membership === "invited" && input.inviteStatus === "pending" && input.schedule !== "ended";
}

export function canDeclineEventInvite(input: {
  membership: EventMembershipView;
  inviteStatus: EventInviteStatus;
}): boolean {
  return input.membership === "invited" && input.inviteStatus === "pending";
}

export function eventChatCanSend(input: {
  membership: EventMembershipView;
  archived: boolean;
  schedule: EventScheduleStatus;
}): boolean {
  if (input.archived || input.schedule === "ended") return false;
  return input.membership === "host" || input.membership === "guest";
}

export function eventChatCanRead(input: { membership: EventMembershipView }): boolean {
  return input.membership === "host" || input.membership === "guest";
}

/** Pairwise crypto_box fan-out. Never include the sender; never invent a shared group key. */
export function eventChatFanoutRecipients(memberIds: readonly string[], senderId: string): string[] {
  const sender = senderId.trim();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of memberIds) {
    const id = raw.trim();
    if (!id || id === sender || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function endingEventArchivesChat(): boolean {
  return true;
}

export function removedMemberLosesFutureEventChat(): boolean {
  return true;
}

export function discoverableDoesNotAutoJoin(): boolean {
  return true;
}
