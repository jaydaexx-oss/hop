import type { EncryptedEnvelope } from "./transport.js";

export const HOP_BLE_SERVICE_UUID = "8e7a0001-6f70-48a1-9c3d-2b1e0a7c5d11";
export const HOP_BLE_HANDSHAKE_UUID = "8e7a0002-6f70-48a1-9c3d-2b1e0a7c5d11";
export const HOP_BLE_INBOX_UUID = "8e7a0003-6f70-48a1-9c3d-2b1e0a7c5d11";
export const HOP_BLE_ACK_UUID = "8e7a0004-6f70-48a1-9c3d-2b1e0a7c5d11";

export const BLE_CHUNK_MAGIC = "HOP1";
export const BLE_DEFAULT_CHUNK_BYTES = 160;
export const BLE_FALLBACK_CHUNK_BYTES = 18;
export const BLE_MAX_CHUNK_PAYLOAD = 512;
export const BLE_MAX_FRAME_BYTES = 8 + BLE_MAX_CHUNK_PAYLOAD;
export const BLE_MAX_ASSEMBLED_BYTES = 70_000;
export const BLE_REASSEMBLER_STALE_MS = 15_000;
export const BLE_SESSION_IDLE_MS = 120_000;
export const BLE_MAX_HANDSHAKE_FIELD = 128;
export const BLE_MAX_HANDSHAKE_BYTES = 512;

export interface BleHandshake {
  v: 2;
  user_id: string;
  username: string;
  pk: string;
  /** Session nonce. Optional for older advertisers; first-packet pk remains TOFU. */
  n?: string;
}

const MAGIC_BYTES = new TextEncoder().encode(BLE_CHUNK_MAGIC);
let handshakeNonceSeq = 0;

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function newHandshakeNonce(): string {
  handshakeNonceSeq += 1;
  return `${Date.now().toString(16)}-${handshakeNonceSeq.toString(16)}`;
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2 !== 0) {
    throw new Error("Invalid hex length");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function boundedField(value: unknown, max = BLE_MAX_HANDSHAKE_FIELD): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  if (trimmed.includes("\0") || trimmed.includes("\n")) return null;
  return trimmed;
}

export function encodeHandshake(handshake: BleHandshake): string {
  return bytesToHex(utf8ToBytes(JSON.stringify(handshake)));
}

export function decodeHandshake(hex: string): BleHandshake | null {
  try {
    const raw = hexToBytes(hex);
    if (raw.length === 0 || raw.length > BLE_MAX_HANDSHAKE_BYTES) return null;
    const data = JSON.parse(bytesToUtf8(raw)) as Partial<BleHandshake>;
    if (data.v !== 2) return null;
    const user_id = boundedField(data.user_id, 64);
    const username = boundedField(data.username, 20);
    const pk = boundedField(data.pk, BLE_MAX_HANDSHAKE_FIELD);
    if (!user_id || !username || !pk) return null;
    const nonce = data.n === undefined ? undefined : boundedField(data.n, 64);
    if (data.n !== undefined && !nonce) return null;
    const handshake: BleHandshake = { v: 2, user_id, username, pk };
    if (nonce) handshake.n = nonce;
    return handshake;
  } catch {
    return null;
  }
}

export function encodeEnvelope(envelope: EncryptedEnvelope): Uint8Array {
  return utf8ToBytes(JSON.stringify(envelope));
}

export function decodeEnvelope(bytes: Uint8Array): EncryptedEnvelope | null {
  if (bytes.length === 0 || bytes.length > BLE_MAX_ASSEMBLED_BYTES) return null;
  try {
    const data = JSON.parse(bytesToUtf8(bytes)) as Partial<EncryptedEnvelope>;
    if (
      typeof data.message_id !== "string" ||
      typeof data.sender_id !== "string" ||
      typeof data.recipient_id !== "string" ||
      typeof data.conversation_id !== "string" ||
      typeof data.encrypted_payload !== "string" ||
      !data.message_id ||
      !data.encrypted_payload
    ) {
      return null;
    }
    if (data.encrypted_payload.length > 65_536) return null;
    return data as EncryptedEnvelope;
  } catch {
    return null;
  }
}

export function chunkBytes(bytes: Uint8Array, chunkBytes = BLE_DEFAULT_CHUNK_BYTES): Uint8Array[] {
  const size = Math.max(1, chunkBytes);
  const total = Math.max(1, Math.ceil(bytes.length / size));
  const frames: Uint8Array[] = [];
  for (let index = 0; index < total; index++) {
    const slice = bytes.subarray(index * size, Math.min(bytes.length, (index + 1) * size));
    const frame = new Uint8Array(8 + slice.length);
    frame.set(MAGIC_BYTES, 0);
    frame[4] = (total >> 8) & 0xff;
    frame[5] = total & 0xff;
    frame[6] = (index >> 8) & 0xff;
    frame[7] = index & 0xff;
    frame.set(slice, 8);
    frames.push(frame);
  }
  return frames;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export class BleReassembler {
  private readonly parts = new Map<number, Uint8Array>();
  private expected = 0;
  private lastPushAt = 0;

  constructor(
    private readonly maxAssembled = BLE_MAX_ASSEMBLED_BYTES,
    private readonly staleMs = BLE_REASSEMBLER_STALE_MS,
  ) {}

  push(frame: Uint8Array, now = Date.now()): Uint8Array | null {
    if (this.lastPushAt && now - this.lastPushAt > this.staleMs) {
      this.reset();
    }
    this.lastPushAt = now;
    if (frame.length < 8 || frame.length > BLE_MAX_FRAME_BYTES) {
      this.reset();
      return null;
    }
    const magic = bytesToUtf8(frame.subarray(0, 4));
    if (magic !== BLE_CHUNK_MAGIC) {
      this.reset();
      return null;
    }
    const total = (frame[4] << 8) | frame[5];
    const index = (frame[6] << 8) | frame[7];
    if (total < 1 || total > 4096 || index < 0 || index >= total) {
      this.reset();
      return null;
    }
    const payload = frame.subarray(8);
    if (payload.length > BLE_MAX_CHUNK_PAYLOAD) {
      this.reset();
      return null;
    }
    if (this.expected !== 0 && this.expected !== total) {
      this.reset();
    }
    this.expected = total;
    const existing = this.parts.get(index);
    if (existing && !bytesEqual(existing, payload)) {
      this.reset();
      return null;
    }
    this.parts.set(index, payload);
    if (this.parts.size < total) return null;
    let length = 0;
    for (let i = 0; i < total; i++) {
      const part = this.parts.get(i);
      if (!part) return null;
      length += part.length;
      if (length > this.maxAssembled) {
        this.reset();
        return null;
      }
    }
    const out = new Uint8Array(length);
    let offset = 0;
    for (let i = 0; i < total; i++) {
      const part = this.parts.get(i)!;
      out.set(part, offset);
      offset += part.length;
    }
    this.reset();
    return out;
  }

  reset(): void {
    this.parts.clear();
    this.expected = 0;
    this.lastPushAt = 0;
  }
}

export function advertiseLocalName(username: string): string {
  const trimmed = username.replace(/[^a-z0-9_]/gi, "").slice(0, 8) || "user";
  return `HOP:${trimmed}`;
}

const MAC_RE = /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LONG_HEX_RE = /^[0-9a-f]{12,}$/i;

/** True for MAC addresses, OS BLE UUIDs, and long hex hardware identifiers. */
export function looksLikeHardwareId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (MAC_RE.test(trimmed) || UUID_RE.test(trimmed)) return true;
  const hex = trimmed.replace(/[:-]/g, "");
  return LONG_HEX_RE.test(hex) && hex.length >= 12;
}

export function safeNearbyDisplayName(displayName?: string | null): string {
  const name = (displayName ?? "").trim();
  if (!name || looksLikeHardwareId(name)) return "HOP user";
  return name;
}

export function displayNameFromAdvertisement(localName?: string | null, deviceName?: string | null): string {
  const raw = (localName || deviceName || "").trim();
  if (raw.startsWith("HOP:")) {
    const rest = raw.slice(4).trim();
    if (rest && !looksLikeHardwareId(rest)) return rest;
  }
  if (raw && !looksLikeHardwareId(raw)) return raw;
  return "HOP user";
}
