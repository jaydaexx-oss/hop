/**
 * CSPRNG identifiers for protocol IDs (message_id, install UUID).
 *
 * Hermes / Expo development-client does not implement Web Crypto
 * `crypto.randomUUID`. It does expose `crypto.getRandomValues` once
 * expo-crypto's native CSPRNG is installed. Never Math.random / Date.
 */
export function createCsprngUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("CSPRNG UUID is unavailable on this runtime");
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  /* RFC 4122 UUID v4 (same shape as backend uuid.uuid4 / Web Crypto randomUUID). */
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function createMessageId(): string {
  return createCsprngUuid();
}
