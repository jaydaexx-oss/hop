/**
 * Unit tests for the rotating tempId module.
 *
 * All functions in protocol/ble/tempId.ts are pure (no React, no native modules)
 * so they can be tested directly with ts-jest in node environment.
 *
 * Test categories:
 *   1. Epoch index computation
 *   2. Epoch expiry timestamps
 *   3. msUntilRotation correctness
 *   4. TempId creation and format
 *   5. Expiry detection
 *   6. Hex conversion (round-trip)
 *   7. shortHex display format
 *   8. generateTempIdBytes randomness and size
 */

import {
  TEMP_ID_SIZE,
  TEMP_ID_ROTATION_MS,
  currentEpochIndex,
  epochExpiresAt,
  msUntilRotation,
  generateTempIdBytes,
  bytesToHex,
  hexToBytes,
  shortHex,
  createTempId,
  isExpiredTempId,
} from '../protocol/ble/tempId';

// ─── 1. Epoch index ────────────────────────────────────────────────────────────

describe('currentEpochIndex', () => {
  it('returns 0 at time 0', () => {
    expect(currentEpochIndex(0)).toBe(0);
  });

  it('returns 0 at time just before first rotation', () => {
    expect(currentEpochIndex(TEMP_ID_ROTATION_MS - 1)).toBe(0);
  });

  it('returns 1 at exactly the first rotation boundary', () => {
    expect(currentEpochIndex(TEMP_ID_ROTATION_MS)).toBe(1);
  });

  it('returns 1 at time just before the second rotation', () => {
    expect(currentEpochIndex(2 * TEMP_ID_ROTATION_MS - 1)).toBe(1);
  });

  it('returns 2 at the second rotation boundary', () => {
    expect(currentEpochIndex(2 * TEMP_ID_ROTATION_MS)).toBe(2);
  });

  it('is monotonically non-decreasing over time', () => {
    const times = [0, 1, TEMP_ID_ROTATION_MS / 2, TEMP_ID_ROTATION_MS, TEMP_ID_ROTATION_MS * 3];
    const epochs = times.map(currentEpochIndex);
    for (let i = 1; i < epochs.length; i++) {
      expect(epochs[i]).toBeGreaterThanOrEqual(epochs[i - 1]);
    }
  });

  it('uses Date.now() when no argument provided (smoke test)', () => {
    const result = currentEpochIndex();
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0); // we're well past epoch 0
  });
});

// ─── 2. Epoch expiry timestamps ────────────────────────────────────────────────

describe('epochExpiresAt', () => {
  it('epoch 0 expires at TEMP_ID_ROTATION_MS', () => {
    expect(epochExpiresAt(0)).toBe(TEMP_ID_ROTATION_MS);
  });

  it('epoch 1 expires at 2 * TEMP_ID_ROTATION_MS', () => {
    expect(epochExpiresAt(1)).toBe(2 * TEMP_ID_ROTATION_MS);
  });

  it('expiry is always TEMP_ID_ROTATION_MS after epoch start', () => {
    for (const i of [0, 1, 5, 100, 1000]) {
      expect(epochExpiresAt(i)).toBe((i + 1) * TEMP_ID_ROTATION_MS);
    }
  });

  it('epoch expiry is strictly in the future relative to epoch start', () => {
    const epochStart = 3 * TEMP_ID_ROTATION_MS;
    expect(epochExpiresAt(3)).toBeGreaterThan(epochStart);
  });
});

// ─── 3. msUntilRotation ───────────────────────────────────────────────────────

describe('msUntilRotation', () => {
  it('returns a positive value for a time in the middle of an epoch', () => {
    const mid = TEMP_ID_ROTATION_MS * 1.5; // middle of epoch 1
    const remaining = msUntilRotation(mid);
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(TEMP_ID_ROTATION_MS);
  });

  it('returns close to TEMP_ID_ROTATION_MS at the start of an epoch', () => {
    const start = TEMP_ID_ROTATION_MS * 2; // exact start of epoch 2
    const remaining = msUntilRotation(start);
    expect(remaining).toBeCloseTo(TEMP_ID_ROTATION_MS, -2); // within 100ms
  });

  it('returns near 0 at the end of an epoch', () => {
    const almostEnd = TEMP_ID_ROTATION_MS - 1;
    const remaining = msUntilRotation(almostEnd);
    expect(remaining).toBeLessThanOrEqual(2);
  });

  it('is always in range (0, TEMP_ID_ROTATION_MS]', () => {
    const testTimes = [
      0, 1, TEMP_ID_ROTATION_MS / 4, TEMP_ID_ROTATION_MS / 2,
      TEMP_ID_ROTATION_MS - 1, TEMP_ID_ROTATION_MS, TEMP_ID_ROTATION_MS * 100,
    ];
    for (const t of testTimes) {
      const ms = msUntilRotation(t);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(TEMP_ID_ROTATION_MS);
    }
  });
});

// ─── 4. createTempId ──────────────────────────────────────────────────────────

describe('createTempId', () => {
  it('returns a TempId with 16-byte array', () => {
    const tid = createTempId(0);
    expect(tid.bytes).toBeInstanceOf(Uint8Array);
    expect(tid.bytes.length).toBe(TEMP_ID_SIZE);
  });

  it('returns a hex string of length 32', () => {
    const tid = createTempId(0);
    expect(tid.hex).toHaveLength(TEMP_ID_SIZE * 2);
    expect(tid.hex).toMatch(/^[0-9a-f]+$/);
  });

  it('sets epochIndex to currentEpochIndex(now)', () => {
    const now = 5 * TEMP_ID_ROTATION_MS + 1000;
    const tid = createTempId(now);
    expect(tid.epochIndex).toBe(currentEpochIndex(now));
  });

  it('sets expiresAt to the end of the current epoch', () => {
    const now = 3 * TEMP_ID_ROTATION_MS + 500;
    const tid = createTempId(now);
    expect(tid.expiresAt).toBe(epochExpiresAt(currentEpochIndex(now)));
  });

  it('hex matches the bytes', () => {
    const tid = createTempId(0);
    expect(tid.hex).toBe(bytesToHex(tid.bytes));
  });

  it('produces different IDs each call (probabilistic)', () => {
    const ids = new Set(Array.from({ length: 20 }, () => createTempId().hex));
    // With 16 random bytes, the chance of collision in 20 draws is ~1e-34.
    expect(ids.size).toBe(20);
  });
});

// ─── 5. isExpiredTempId ───────────────────────────────────────────────────────

describe('isExpiredTempId', () => {
  it('is not expired before expiresAt', () => {
    const tid = createTempId(0);
    expect(isExpiredTempId(tid, tid.expiresAt - 1)).toBe(false);
  });

  it('is expired at exactly expiresAt', () => {
    const tid = createTempId(0);
    expect(isExpiredTempId(tid, tid.expiresAt)).toBe(true);
  });

  it('is expired after expiresAt', () => {
    const tid = createTempId(0);
    expect(isExpiredTempId(tid, tid.expiresAt + 1)).toBe(true);
  });

  it('is not expired 1 ms before expiresAt', () => {
    const now = TEMP_ID_ROTATION_MS * 7;
    const tid = createTempId(now);
    expect(isExpiredTempId(tid, tid.expiresAt - 1)).toBe(false);
  });
});

// ─── 6. Hex round-trip ────────────────────────────────────────────────────────

describe('bytesToHex / hexToBytes round-trip', () => {
  it('round-trips 16 zero bytes', () => {
    const bytes = new Uint8Array(16);
    const hex = bytesToHex(bytes);
    expect(hex).toBe('0'.repeat(32));
    const back = hexToBytes(hex);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  it('round-trips 16 max bytes (0xFF)', () => {
    const bytes = new Uint8Array(16).fill(0xff);
    const hex = bytesToHex(bytes);
    expect(hex).toBe('f'.repeat(32));
    const back = hexToBytes(hex);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  it('round-trips arbitrary bytes', () => {
    const original = new Uint8Array([0x00, 0x01, 0xAB, 0xCD, 0xEF, 0x10, 0x20, 0x30,
                                     0x40, 0x50, 0x60, 0x70, 0x80, 0x90, 0xA0, 0xFF]);
    const hex = bytesToHex(original);
    const back = hexToBytes(hex);
    expect(Array.from(back)).toEqual(Array.from(original));
  });

  it('hexToBytes throws for wrong-length input', () => {
    expect(() => hexToBytes('')).toThrow();
    expect(() => hexToBytes('ab')).toThrow();
    expect(() => hexToBytes('a'.repeat(31))).toThrow();
    expect(() => hexToBytes('a'.repeat(33))).toThrow();
  });

  it('bytesToHex always produces lowercase', () => {
    const bytes = new Uint8Array([0xAB, 0xCD, 0xEF, 0x00, 0x11, 0x22, 0x33, 0x44,
                                  0x55, 0x66, 0x77, 0x88, 0x99, 0xAA, 0xBB, 0xCC]);
    const hex = bytesToHex(bytes);
    expect(hex).toBe(hex.toLowerCase());
  });
});

// ─── 7. shortHex ─────────────────────────────────────────────────────────────

describe('shortHex', () => {
  it('shows first 4 and last 4 chars with ellipsis', () => {
    expect(shortHex('abcdef1234567890abcdef1234567890')).toBe('abcd…7890');
  });

  it('handles short strings gracefully (returns as-is for strings under threshold)', () => {
    expect(shortHex('ab')).toBe('ab');
    // 8 chars < 10-char threshold — returned unchanged
    expect(shortHex('abcdefgh')).toBe('abcdefgh');
    // exactly 10 chars is NOT truncated (threshold is < 10, so 10 gets truncated)
    expect(shortHex('a'.repeat(10))).toBe('aaaa…aaaa');
  });
});

// ─── 8. generateTempIdBytes ───────────────────────────────────────────────────

describe('generateTempIdBytes', () => {
  it('returns exactly TEMP_ID_SIZE bytes', () => {
    const bytes = generateTempIdBytes();
    expect(bytes.length).toBe(TEMP_ID_SIZE);
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it('produces values in [0, 255]', () => {
    const bytes = generateTempIdBytes();
    for (const b of bytes) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    }
  });

  it('is not all zeros (probabilistic)', () => {
    const bytes = generateTempIdBytes();
    const allZero = Array.from(bytes).every(b => b === 0);
    // Probability of all 16 bytes being 0: (1/256)^16 ≈ 5e-39
    expect(allZero).toBe(false);
  });
});
