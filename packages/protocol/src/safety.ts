import { looksLikeHardwareId } from "./bleCodec.js";

export type PeerRelationship =
  | "none"
  | "outgoing_request"
  | "incoming_request"
  | "accepted"
  | "declined"
  | "blocked";

export type SafetyDenialCode = "blocked" | "intro_limit" | "declined" | "not_accepted";

export type InboxVisibility = "chat" | "request" | "hidden";

export type PeerSafetyRecord = {
  peerId: string;
  relationship: PeerRelationship;
  muted: boolean;
  introMessageId: string | null;
  preBlockRelationship: PeerRelationship | null;
  updatedAt: string;
};

export type SafetyDecision =
  | { allow: true; asRequest?: boolean; mutualAccept?: boolean }
  | { allow: false; code: SafetyDenialCode; message: string };

export type ReportCategory = "spam" | "harassment" | "impersonation" | "other";

export type LocalReportRecord = {
  id: string;
  peerId: string;
  category: ReportCategory;
  note: string | null;
  createdAt: string;
};

export const SAFETY_MESSAGES: Record<SafetyDenialCode, string> = {
  blocked: "This person is blocked.",
  intro_limit: "You already sent an introduction. Wait until they accept.",
  declined: "This person declined your request.",
  not_accepted: "Accept this request before sending messages.",
};

export class SafetyError extends Error {
  readonly code: SafetyDenialCode;

  constructor(code: SafetyDenialCode, message = SAFETY_MESSAGES[code]) {
    super(message);
    this.name = "SafetyError";
    this.code = code;
  }
}

export function isSafetyError(error: unknown): error is SafetyError {
  return error instanceof SafetyError;
}

export function denySafety(code: SafetyDenialCode): SafetyDecision {
  return { allow: false, code, message: SAFETY_MESSAGES[code] };
}

/** Block overrides BLE, internet, requests, and QR. Mute never equals block. */
export function decideOutbound(record: PeerSafetyRecord | null): SafetyDecision {
  const rel = record?.relationship ?? "none";
  if (rel === "blocked") return denySafety("blocked");
  if (rel === "declined") return denySafety("declined");
  if (rel === "accepted") return { allow: true };
  if (rel === "outgoing_request") return denySafety("intro_limit");
  if (rel === "incoming_request") return denySafety("not_accepted");
  return { allow: true, asRequest: true };
}

/**
 * Unknown senders become a message request. A second intro is dropped.
 * A reply while we have an outgoing request is mutual consent → accept.
 */
export function decideInbound(record: PeerSafetyRecord | null): SafetyDecision {
  const rel = record?.relationship ?? "none";
  if (rel === "blocked") return denySafety("blocked");
  if (rel === "declined") return denySafety("declined");
  if (rel === "accepted") return { allow: true };
  if (rel === "outgoing_request") return { allow: true, mutualAccept: true };
  if (rel === "incoming_request") return denySafety("intro_limit");
  return { allow: true, asRequest: true };
}

export function decideQrContact(record: PeerSafetyRecord | null): SafetyDecision {
  return decideOutbound(record);
}

export function inboxVisibilityFor(record: PeerSafetyRecord | null): InboxVisibility {
  const rel = record?.relationship ?? "none";
  if (rel === "blocked" || rel === "declined") return "hidden";
  if (rel === "incoming_request" || rel === "outgoing_request") return "request";
  if (rel === "accepted") return "chat";
  return "hidden";
}

export function shouldNotifyFor(record: PeerSafetyRecord | null): boolean {
  if (!record) return true;
  if (record.relationship === "blocked" || record.relationship === "declined") return false;
  if (record.muted) return false;
  return record.relationship === "accepted" || record.relationship === "incoming_request";
}

export function isDiscoverableMode(privacyMode: string): boolean {
  return privacyMode === "contacts" || privacyMode === "everyone";
}

export function privacyModeForDiscoverable(
  discoverable: boolean,
  lastOnMode: string | null | undefined,
): "invisible" | "contacts" | "everyone" {
  if (!discoverable) return "invisible";
  if (lastOnMode === "contacts" || lastOnMode === "everyone") return lastOnMode;
  return "everyone";
}

export function rememberDiscoverableMode(
  mode: string,
  previous: string | null | undefined,
): "contacts" | "everyone" {
  if (mode === "contacts" || mode === "everyone") return mode;
  if (previous === "contacts" || previous === "everyone") return previous;
  return "everyone";
}

/** Event Mode must not advertise while Invisible / Discoverable off. */
export function eventModeMayRun(privacyMode: string): boolean {
  return isDiscoverableMode(privacyMode);
}

/** Primary Nearby UX mode. Derived — not a second privacy system. */
export type NearbyOperatingMode = "around_us" | "event" | "invisible";

export type NearbyAudience = "contacts" | "everyone";

/**
 * INVISIBLE  ↔ privacyMode === 'invisible' (Event cannot run)
 * AROUND US  ↔ Discoverable AND event off
 * EVENT MODE ↔ Discoverable AND event on
 */
export function deriveOperatingMode(
  privacyMode: string,
  eventEnabled: boolean,
): NearbyOperatingMode {
  if (!isDiscoverableMode(privacyMode)) return "invisible";
  if (eventEnabled && eventModeMayRun(privacyMode)) return "event";
  return "around_us";
}

/** Invisible always wins. A stale Event flag cannot keep discovery on. */
export function eventEnabledAfterPrivacyChange(
  privacyMode: string,
  eventEnabled: boolean,
): boolean {
  return eventEnabled && eventModeMayRun(privacyMode);
}

/**
 * Last tap wins. A delayed Event enable must not persist after a later
 * Invisible (or any newer mode request) has already been applied.
 */
export function mayCommitEventEnable(input: {
  requestId: number;
  latestRequestId: number;
  privacyMode: string;
}): boolean {
  if (input.requestId !== input.latestRequestId) return false;
  return eventModeMayRun(input.privacyMode);
}

/** Event expiry returns Around Us whenever Discoverable is still on. */
export function operatingModeAfterEventExpiry(privacyMode: string): NearbyOperatingMode {
  return isDiscoverableMode(privacyMode) ? "around_us" : "invisible";
}

export type OperatingModePlan = {
  nextPrivacyMode: "invisible" | NearbyAudience;
  nextEventEnabled: boolean;
  /** Event requested while Invisible with no audience — do not advertise. */
  blockedByInvisible: boolean;
  lastDiscoverableMode: NearbyAudience;
};

function asAudience(value: string | null | undefined): NearbyAudience | null {
  return value === "contacts" || value === "everyone" ? value : null;
}

/**
 * Plan a 3-mode transition. Does not persist. Event from Invisible without an
 * explicit audience stays Invisible and does not enable Event Mode.
 */
export function planOperatingMode(input: {
  target: NearbyOperatingMode;
  privacyMode: string;
  lastDiscoverableMode?: string | null;
  eventEnabled: boolean;
  audience?: string | null;
}): OperatingModePlan {
  const lastOn = rememberDiscoverableMode(input.privacyMode, input.lastDiscoverableMode);
  const requested = asAudience(input.audience);

  if (input.target === "invisible") {
    return {
      nextPrivacyMode: "invisible",
      nextEventEnabled: false,
      blockedByInvisible: false,
      lastDiscoverableMode: lastOn,
    };
  }

  if (input.target === "around_us") {
    const audience = requested ?? lastOn;
    return {
      nextPrivacyMode: audience,
      nextEventEnabled: false,
      blockedByInvisible: false,
      lastDiscoverableMode: audience,
    };
  }

  if (!eventModeMayRun(input.privacyMode) && !requested) {
    return {
      nextPrivacyMode: "invisible",
      nextEventEnabled: false,
      blockedByInvisible: true,
      lastDiscoverableMode: lastOn,
    };
  }

  const audience = requested ?? asAudience(input.privacyMode) ?? lastOn;
  return {
    nextPrivacyMode: audience,
    nextEventEnabled: true,
    blockedByInvisible: false,
    lastDiscoverableMode: audience,
  };
}

export function inferRelationshipFromHistory(input: {
  inboundCount: number;
  outboundCount: number;
}): PeerRelationship {
  if (input.inboundCount > 0 && input.outboundCount > 0) return "accepted";
  if (input.outboundCount > 1) return "accepted";
  if (input.outboundCount === 1 && input.inboundCount === 0) return "outgoing_request";
  if (input.inboundCount >= 1 && input.outboundCount === 0) return "incoming_request";
  return "none";
}

export function relationshipAfterUnblock(record: PeerSafetyRecord): PeerRelationship {
  const prior = record.preBlockRelationship;
  if (prior && prior !== "blocked") return prior;
  return "none";
}

export function isBleDebugEnabled(isDev: boolean): boolean {
  return isDev === true;
}

/** Hardware IDs stay hidden even in developer BLE debug. */
export function bleDebugExposesHardwareId(): boolean {
  return false;
}

export function isUnsafeNearbyLabel(value: string | null | undefined): boolean {
  if (!value) return false;
  return looksLikeHardwareId(value);
}

export const REPORT_CATEGORIES: ReportCategory[] = ["spam", "harassment", "impersonation", "other"];

export function parseReportCategory(value: string): ReportCategory | null {
  return REPORT_CATEGORIES.includes(value as ReportCategory) ? (value as ReportCategory) : null;
}

export type SafetyGate = {
  decideOutbound(peerId: string): Promise<SafetyDecision>;
  decideInbound(peerId: string): Promise<SafetyDecision>;
  recordOutboundIntro(peerId: string, messageId: string): Promise<void>;
  recordInboundIntro(peerId: string, messageId: string): Promise<void>;
  markAccepted(peerId: string): Promise<void>;
  inboxVisibility(peerId: string | null | undefined): Promise<InboxVisibility>;
  isBlocked(peerId: string | null | undefined): Promise<boolean>;
};
