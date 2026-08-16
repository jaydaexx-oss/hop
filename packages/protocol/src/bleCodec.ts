import type { EncryptedEnvelope } from "./transport.js";

export const HOP_BLE_SERVICE_UUID = "8e7a0001-6f70-48a1-9c3d-2b1e0a7c5d11";
export const HOP_BLE_HANDSHAKE_UUID = "8e7a0002-6f70-48a1-9c3d-2b1e0a7c5d11";
export const HOP_BLE_INBOX_UUID = "8e7a0003-6f70-48a1-9c3d-2b1e0a7c5d11";
export const HOP_BLE_ACK_UUID = "8e7a0004-6f70-48a1-9c3d-2b1e0a7c5d11";

export const BLE_CHUNK_MAGIC = "HOP1";
export const BLE_DEFAULT_CHUNK_BYTES = 160;
export const BLE_FALLBACK_CHUNK_BYTES = 18;

export interface BleHandshake {
  v: 2;
  user_id: string;
  username: string;
  pk: string;
}

const MAGIC_BYTES = new TextEncoder().encode(BLE_CHUNK_MAGIC);

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
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

export function encodeHandshake(handshake: BleHandshake): string {
  return bytesToHex(utf8ToBytes(JSON.stringify(handshake)));
}

export function decodeHandshake(hex: string): BleHandshake | null {
  try {
    const data = JSON.parse(bytesToUtf8(hexToBytes(hex))) as Partial<BleHandshake>;
    if (data.v !== 2 || typeof data.user_id !== "string" || typeof data.username !== "string" || typeof data.pk !== "string") {
      return null;
    }
    return { v: 2, user_id: data.user_id, username: data.username, pk: data.pk };
  } catch {
    return null;
  }
}

export function encodeEnvelope(envelope: EncryptedEnvelope): Uint8Array {
  return utf8ToBytes(JSON.stringify(envelope));
}

export function decodeEnvelope(bytes: Uint8Array): EncryptedEnvelope | null {
  try {
    const data = JSON.parse(bytesToUtf8(bytes)) as EncryptedEnvelope;
    if (!data?.message_id || !data.encrypted_payload) return null;
    return data;
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

export class BleReassembler {
  private readonly parts = new Map<number, Uint8Array>();
  private expected = 0;

  push(frame: Uint8Array): Uint8Array | null {
    if (frame.length < 8) return null;
    const magic = bytesToUtf8(frame.subarray(0, 4));
    if (magic !== BLE_CHUNK_MAGIC) return null;
    const total = (frame[4] << 8) | frame[5];
    const index = (frame[6] << 8) | frame[7];
    if (total < 1 || index < 0 || index >= total) return null;
    if (this.expected !== 0 && this.expected !== total) {
      this.reset();
    }
    this.expected = total;
    this.parts.set(index, frame.subarray(8));
    if (this.parts.size < total) return null;
    let length = 0;
    for (let i = 0; i < total; i++) {
      const part = this.parts.get(i);
      if (!part) return null;
      length += part.length;
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
