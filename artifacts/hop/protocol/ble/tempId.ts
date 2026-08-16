/**
 * Rotating temporary device identifier for HOP BLE advertising.
 *
 * Privacy design
 * ──────────────
 * HOP devices advertise a tempId instead of their permanent profile.id.
 * This prevents passive observers from tracking users across scan periods.
 *
 * Each tempId is:
 *   • 16 bytes of pseudo-random data
 *   • Valid for one rotation epoch (TEMP_ID_ROTATION_MS = 10 minutes)
 *   • Stored only in memory — a new one is generated each app session
 *
 * Current implementation: Math.random()-based bytes.
 * Production hardening: Use HKDF(profileId, epochIndex, secretKey) so peers
 * can validate the tempId during an authenticated handshake without storing
 * a lookup table.  This is intentionally deferred to the auth milestone.
 *
 * Zero dependencies — safe to import in unit tests and web environments.
 */

export const TEMP_ID_SIZE = 16;
export const TEMP_ID_ROTATION_MS = 10 * 60 * 1000; // 10 minutes

export interface TempId {
  /** Raw 16-byte identifier */
  bytes: Uint8Array;
  /** 32-character lowercase hex string for display and logging */
  hex: string;
  /** Which 10-minute window produced this ID */
  epochIndex: number;
  /** Unix timestamp (ms) when this ID will rotate */
  expiresAt: number;
}

// ─── Epoch helpers ────────────────────────────────────────────────────────────

export function currentEpochIndex(now = Date.now()): number {
  return Math.floor(now / TEMP_ID_ROTATION_MS);
}

export function epochExpiresAt(epochIndex: number): number {
  return (epochIndex + 1) * TEMP_ID_ROTATION_MS;
}

export function msUntilRotation(now = Date.now()): number {
  return epochExpiresAt(currentEpochIndex(now)) - now;
}

// ─── Byte generation ─────────────────────────────────────────────────────────

/**
 * Generate 16 pseudo-random bytes.
 *
 * NOTE: Math.random() is used intentionally — this tempId is NOT a
 * cryptographic secret and is NOT used for authentication.  Its only
 * purpose is to make passive tracking harder.  Replace with
 * crypto.getRandomValues() when the authentication milestone lands.
 */
export function generateTempIdBytes(): Uint8Array {
  const bytes = new Uint8Array(TEMP_ID_SIZE);
  for (let i = 0; i < TEMP_ID_SIZE; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

// ─── Conversion helpers ───────────────────────────────────────────────────────

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length !== TEMP_ID_SIZE * 2) {
    throw new Error(`Expected ${TEMP_ID_SIZE * 2} hex chars, got ${hex.length}`);
  }
  const bytes = new Uint8Array(TEMP_ID_SIZE);
  for (let i = 0; i < TEMP_ID_SIZE; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Short display form: first 4 and last 4 hex chars separated by '…' */
export function shortHex(hex: string): string {
  if (hex.length < 10) return hex;
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

// ─── TempId factory ───────────────────────────────────────────────────────────

export function createTempId(now = Date.now()): TempId {
  const bytes = generateTempIdBytes();
  const epochIndex = currentEpochIndex(now);
  return {
    bytes,
    hex: bytesToHex(bytes),
    epochIndex,
    expiresAt: epochExpiresAt(epochIndex),
  };
}

/** Returns true if the tempId was created in a different epoch than now. */
export function isExpiredTempId(tempId: TempId, now = Date.now()): boolean {
  return now >= tempId.expiresAt;
}
