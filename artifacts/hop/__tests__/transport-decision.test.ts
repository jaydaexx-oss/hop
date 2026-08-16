/**
 * Transport decision logic tests.
 *
 * Tests the resolveTransport() pure function from useTransportState.ts.
 * These tests do NOT require React, a native BLE module, or a network — they
 * are purely deterministic input/output tests of the priority logic.
 *
 * Priority under test (must match transportManager.ts PRIORITY array):
 *   bluetooth > internet > queued
 *
 * Test categories:
 *   1. BLE peer present + peerId matches    → bluetooth
 *   2. BLE peer present + peerId mismatch   → internet (if online) / queued
 *   3. No BLE peers, online                 → internet
 *   4. No BLE peers, offline                → queued
 *   5. undefined peerId                     → internet or queued (never bluetooth)
 *   6. Priority: BLE beats internet when both available
 *   7. Empty verifiedBlePeers set           → falls through to internet/queued
 *   8. Multiple BLE peers — only matching one triggers bluetooth
 */

import { resolveTransport } from '../protocol/transport-decision';
import type { TransportKind } from '../protocol/transport-decision';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function peers(...ids: string[]): ReadonlySet<string> {
  return new Set(ids);
}

function expect_transport(
  result: TransportKind,
  expected: TransportKind,
  context?: string,
) {
  expect(result).toBe(expected);
}

// ─── 1. Verified BLE peer + matching peerId → bluetooth ──────────────────────

describe('resolveTransport — bluetooth priority', () => {
  it('returns bluetooth when peerId is in verifiedBlePeers and online', () => {
    const result = resolveTransport('user-abc', peers('user-abc'), true);
    expect(result).toBe('bluetooth');
  });

  it('returns bluetooth when peerId is in verifiedBlePeers and OFFLINE', () => {
    // BLE does not require internet — must work even when isOnline is false.
    const result = resolveTransport('user-abc', peers('user-abc'), false);
    expect(result).toBe('bluetooth');
  });

  it('returns bluetooth with multiple peers when the target peer is present', () => {
    const result = resolveTransport(
      'target',
      peers('other-1', 'target', 'other-2'),
      true,
    );
    expect(result).toBe('bluetooth');
  });
});

// ─── 2. BLE peer present but peerId does not match ───────────────────────────

describe('resolveTransport — BLE peer present but wrong peer', () => {
  it('returns internet (not bluetooth) when a BLE peer exists but peerId does not match', () => {
    const result = resolveTransport('user-abc', peers('user-xyz'), true);
    expect(result).toBe('internet');
  });

  it('returns queued when a BLE peer exists but peerId does not match and offline', () => {
    const result = resolveTransport('user-abc', peers('user-xyz'), false);
    expect(result).toBe('queued');
  });
});

// ─── 3. No BLE peers, online ──────────────────────────────────────────────────

describe('resolveTransport — internet fallback', () => {
  it('returns internet when no BLE peers and online', () => {
    const result = resolveTransport('user-abc', peers(), true);
    expect(result).toBe('internet');
  });

  it('returns internet when verifiedBlePeers is empty and online', () => {
    const result = resolveTransport('user-abc', new Set<string>(), true);
    expect(result).toBe('internet');
  });
});

// ─── 4. No BLE peers, offline ─────────────────────────────────────────────────

describe('resolveTransport — queued fallback', () => {
  it('returns queued when no BLE peers and offline', () => {
    const result = resolveTransport('user-abc', peers(), false);
    expect(result).toBe('queued');
  });

  it('returns queued with an empty peer set and offline', () => {
    const result = resolveTransport('user-abc', new Set<string>(), false);
    expect(result).toBe('queued');
  });
});

// ─── 5. undefined peerId ──────────────────────────────────────────────────────

describe('resolveTransport — undefined peerId', () => {
  it('never returns bluetooth for undefined peerId even with peers present', () => {
    const result = resolveTransport(undefined, peers('anyone'), true);
    expect(result).not.toBe('bluetooth');
  });

  it('returns internet for undefined peerId when online', () => {
    const result = resolveTransport(undefined, peers('anyone'), true);
    expect(result).toBe('internet');
  });

  it('returns queued for undefined peerId when offline', () => {
    const result = resolveTransport(undefined, peers('anyone'), false);
    expect(result).toBe('queued');
  });

  it('returns queued for undefined peerId with no peers and offline', () => {
    const result = resolveTransport(undefined, peers(), false);
    expect(result).toBe('queued');
  });
});

// ─── 6. Priority ordering ─────────────────────────────────────────────────────

describe('resolveTransport — priority: bluetooth > internet > queued', () => {
  it('BLE beats internet: bluetooth when BLE peer present + online', () => {
    // Both BLE (peer found) and Internet (online) available — BLE wins.
    const result = resolveTransport('peer-id', peers('peer-id'), true);
    expect(result).toBe('bluetooth');
  });

  it('internet beats queued: internet when online + no BLE peer', () => {
    const result = resolveTransport('peer-id', peers(), true);
    expect(result).toBe('internet');
  });

  it('full priority chain: BLE > internet > queued verified in isolation', () => {
    // All three states tested with the target peer present/absent
    const bleResult  = resolveTransport('p', peers('p'), true);
    const netResult  = resolveTransport('p', peers(),    true);
    const queueResult = resolveTransport('p', peers(),   false);

    expect(bleResult).toBe('bluetooth');
    expect(netResult).toBe('internet');
    expect(queueResult).toBe('queued');
  });
});

// ─── 7. Large peer sets ───────────────────────────────────────────────────────

describe('resolveTransport — large peer sets', () => {
  it('finds the matching peer in a large set', () => {
    const manyPeers = new Set(
      Array.from({ length: 100 }, (_, i) => `peer-${i}`),
    );
    manyPeers.add('my-target');

    const result = resolveTransport('my-target', manyPeers, true);
    expect(result).toBe('bluetooth');
  });

  it('does not find a non-existent peer in a large set', () => {
    const manyPeers = new Set(
      Array.from({ length: 100 }, (_, i) => `peer-${i}`),
    );

    const result = resolveTransport('not-in-set', manyPeers, true);
    expect(result).toBe('internet');
  });
});

// ─── 8. Empty string peerId ───────────────────────────────────────────────────

describe('resolveTransport — edge cases', () => {
  it('empty string peerId does not match anything', () => {
    // An empty string peer set entry should never exist, but even if it did:
    const result = resolveTransport('', peers(''), true);
    // Empty string is falsy — resolveTransport guards with `if (peerId && ...)`
    expect(result).toBe('internet');
  });

  it('is deterministic — same inputs always produce same output', () => {
    for (let i = 0; i < 20; i++) {
      expect(resolveTransport('p', peers('p'), true)).toBe('bluetooth');
      expect(resolveTransport('p', peers(),   true)).toBe('internet');
      expect(resolveTransport('p', peers(),   false)).toBe('queued');
    }
  });
});
