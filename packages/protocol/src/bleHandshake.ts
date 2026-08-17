import { HandshakeReplayGuard } from "./bleGuard.js";
import { bytesToUtf8, hexToBytes, utf8ToBytes } from "./bleCodec.js";
import {
  isWellFormedBoxPublicKey,
  readySodium,
  type IdentityKeyPair,
} from "./cryptoBox.js";
import type { PublicKeyTofu } from "./tofu.js";

export const BLE_HANDSHAKE_VERSION = 3;
export const BLE_HANDSHAKE_CONTEXT = "hop-ble-hs-v3";
export const BLE_HANDSHAKE_MAX_SKEW_MS = 5 * 60_000;
export const BLE_HANDSHAKE_DOWNGRADE = "Unauthenticated BLE handshake is not accepted";

export interface BleHandshakeAnnouncement {
  v: typeof BLE_HANDSHAKE_VERSION;
  user_id: string;
  username: string;
  pk: string;
  n: string;
  ts: number;
}

export interface BleAuthenticatedHandshake extends BleHandshakeAnnouncement {
  peer_pk: string;
  auth: string;
}

export type HandshakeVerifyFailure =
  | "malformed"
  | "downgrade"
  | "replay"
  | "stale"
  | "bad_mac"
  | "key_changed"
  | "peer_mismatch"
  | "malformed_pk";

export type HandshakeVerifyResult =
  | { ok: true; handshake: BleAuthenticatedHandshake }
  | { ok: false; reason: HandshakeVerifyFailure };

function handshakeMacKey(shared: Uint8Array, sodium: Awaited<ReturnType<typeof readySodium>>): Uint8Array {
  return sodium.crypto_generichash(
    sodium.crypto_auth_KEYBYTES,
    shared,
    sodium.from_string(BLE_HANDSHAKE_CONTEXT),
  );
}

function canonicalTranscript(input: {
  v: number;
  user_id: string;
  username: string;
  pk: string;
  n: string;
  ts: number;
  peer_pk: string;
}): string {
  return [
    BLE_HANDSHAKE_CONTEXT,
    input.v,
    input.user_id,
    input.username,
    input.pk,
    input.n,
    String(input.ts),
    input.peer_pk,
  ].join("|");
}

export async function newAuthHandshakeNonce(): Promise<string> {
  const s = await readySodium();
  return s.to_base64(s.randombytes_buf(16), s.base64_variants.ORIGINAL);
}

export function encodeHandshakeAnnouncement(input: BleHandshakeAnnouncement): string {
  return JSON.stringify({
    v: BLE_HANDSHAKE_VERSION,
    user_id: input.user_id,
    username: input.username,
    pk: input.pk,
    n: input.n,
    ts: input.ts,
  });
}

export function parseHandshakeJson(raw: string): Record<string, unknown> | null {
  if (!raw || raw.length > 1024) return null;
  try {
    const asJson = JSON.parse(raw) as unknown;
    if (asJson && typeof asJson === "object") return asJson as Record<string, unknown>;
  } catch {
    /* hex-encoded legacy */
  }
  try {
    const decoded = bytesToUtf8(hexToBytes(raw));
    const asJson = JSON.parse(decoded) as unknown;
    if (asJson && typeof asJson === "object") return asJson as Record<string, unknown>;
  } catch {
    return null;
  }
  return null;
}

/** Discoverability packet. pk is still plaintext TOFU. v<3 or missing nonce/ts is a downgrade. */
export function decodeHandshakeAnnouncement(raw: string): BleHandshakeAnnouncement | null {
  const data = parseHandshakeJson(raw);
  if (!data) return null;
  if (data.v !== BLE_HANDSHAKE_VERSION) return null;
  if (typeof data.user_id !== "string" || typeof data.username !== "string" || typeof data.pk !== "string") {
    return null;
  }
  if (typeof data.n !== "string" || typeof data.ts !== "number" || !Number.isFinite(data.ts)) return null;
  if (!data.user_id.trim() || !data.username.trim() || !data.n.trim()) return null;
  if (!isWellFormedBoxPublicKey(data.pk)) return null;
  return {
    v: BLE_HANDSHAKE_VERSION,
    user_id: data.user_id.trim(),
    username: data.username.trim(),
    pk: data.pk,
    n: data.n.trim(),
    ts: data.ts,
  };
}

export async function encodeAuthenticatedHandshake(input: {
  local: IdentityKeyPair;
  userId: string;
  username: string;
  nonce: string;
  ts: number;
  peerPublicKey: string;
}): Promise<string> {
  if (!isWellFormedBoxPublicKey(input.local.publicKey) || !isWellFormedBoxPublicKey(input.peerPublicKey)) {
    throw new Error("Malformed handshake public key");
  }
  const s = await readySodium();
  const variant = s.base64_variants.ORIGINAL;
  const shared = s.crypto_box_beforenm(
    s.from_base64(input.peerPublicKey, variant),
    s.from_base64(input.local.secretKey, variant),
  );
  const key = handshakeMacKey(shared, s);
  const body: BleAuthenticatedHandshake = {
    v: BLE_HANDSHAKE_VERSION,
    user_id: input.userId,
    username: input.username,
    pk: input.local.publicKey,
    n: input.nonce,
    ts: input.ts,
    peer_pk: input.peerPublicKey,
    auth: "",
  };
  const mac = s.crypto_auth(s.from_string(canonicalTranscript(body)), key);
  body.auth = s.to_base64(mac, variant);
  return JSON.stringify(body);
}

export function decodeAuthenticatedHandshake(raw: string): BleAuthenticatedHandshake | null {
  const data = parseHandshakeJson(raw);
  if (!data) return null;
  if (data.v === 1 || data.v === 2 || data.auth === undefined || data.auth === "") {
    return null;
  }
  if (data.v !== BLE_HANDSHAKE_VERSION) return null;
  if (
    typeof data.user_id !== "string" ||
    typeof data.username !== "string" ||
    typeof data.pk !== "string" ||
    typeof data.n !== "string" ||
    typeof data.ts !== "number" ||
    typeof data.peer_pk !== "string" ||
    typeof data.auth !== "string"
  ) {
    return null;
  }
  if (!isWellFormedBoxPublicKey(data.pk) || !isWellFormedBoxPublicKey(data.peer_pk)) return null;
  return {
    v: BLE_HANDSHAKE_VERSION,
    user_id: data.user_id.trim(),
    username: data.username.trim(),
    pk: data.pk,
    n: data.n.trim(),
    ts: data.ts,
    peer_pk: data.peer_pk,
    auth: data.auth,
  };
}

export function handshakeDowngradeReason(raw: string): HandshakeVerifyFailure | null {
  const data = parseHandshakeJson(raw);
  if (!data) return "malformed";
  if (data.v === 1 || data.v === 2) return "downgrade";
  if (data.v === BLE_HANDSHAKE_VERSION && (data.auth === undefined || data.auth === "")) return "downgrade";
  if (data.v !== BLE_HANDSHAKE_VERSION) return "malformed";
  return null;
}

export async function verifyAuthenticatedHandshake(input: {
  raw: string;
  local: IdentityKeyPair;
  replay: HandshakeReplayGuard;
  tofu?: PublicKeyTofu;
  now?: number;
}): Promise<HandshakeVerifyResult> {
  const now = input.now ?? Date.now();
  const downgrade = handshakeDowngradeReason(input.raw);
  const parsed = decodeAuthenticatedHandshake(input.raw);
  if (!parsed) {
    return { ok: false, reason: downgrade ?? "malformed" };
  }
  if (parsed.peer_pk !== input.local.publicKey) {
    return { ok: false, reason: "peer_mismatch" };
  }
    if (Math.abs(now - parsed.ts) > BLE_HANDSHAKE_MAX_SKEW_MS) {
      return { ok: false, reason: "stale" };
    }
    try {
      const s = await readySodium();
      const variant = s.base64_variants.ORIGINAL;
      const shared = s.crypto_box_beforenm(
        s.from_base64(parsed.pk, variant),
        s.from_base64(input.local.secretKey, variant),
      );
      const key = handshakeMacKey(shared, s);
      const ok = s.crypto_auth_verify(
        s.from_base64(parsed.auth, variant),
        s.from_string(canonicalTranscript(parsed)),
        key,
      );
      if (!ok) return { ok: false, reason: "bad_mac" };
    } catch {
      return { ok: false, reason: "bad_mac" };
    }
    if (!input.replay.remember(parsed.user_id, parsed.n, now)) {
      return { ok: false, reason: "replay" };
    }
    if (input.tofu && !input.tofu.bind(parsed.user_id, parsed.pk)) {
      return { ok: false, reason: "key_changed" };
    }
    return { ok: true, handshake: parsed };
}

/** In-process both-sides handshake. No radio. */
export class BleHandshakeExchange {
  readonly nonce: string;
  readonly ts: number;

  constructor(
    readonly local: IdentityKeyPair,
    readonly userId: string,
    readonly username: string,
    nonce: string,
    ts = Date.now(),
  ) {
    this.nonce = nonce;
    this.ts = ts;
  }

  static async create(local: IdentityKeyPair, userId: string, username: string, ts = Date.now()): Promise<BleHandshakeExchange> {
    return new BleHandshakeExchange(local, userId, username, await newAuthHandshakeNonce(), ts);
  }

  announcement(): string {
    return encodeHandshakeAnnouncement({
      v: BLE_HANDSHAKE_VERSION,
      user_id: this.userId,
      username: this.username,
      pk: this.local.publicKey,
      n: this.nonce,
      ts: this.ts,
    });
  }

  proveTo(peerPublicKey: string): Promise<string> {
    return encodeAuthenticatedHandshake({
      local: this.local,
      userId: this.userId,
      username: this.username,
      nonce: this.nonce,
      ts: this.ts,
      peerPublicKey,
    });
  }
}

export function utf8HandshakeBytes(json: string): Uint8Array {
  return utf8ToBytes(json);
}
