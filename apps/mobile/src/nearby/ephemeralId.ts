const ALPH = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < n; i += 1) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

/** Short rotating discovery label for BLE ads. Never a user UUID or hardware id. */
export function createEphemeralDiscoveryId(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (const byte of bytes) {
    out += ALPH[byte % ALPH.length];
  }
  return out;
}

/** Local Event Mode session stub (not advertised, not a venue or GPS id). */
export function createEventSessionId(): string {
  return `local:${createEphemeralDiscoveryId()}${createEphemeralDiscoveryId().slice(0, 4)}`;
}

/**
 * Stable opaque token for list keys. Derived from the OS device id so React
 * can reconcile rows without rendering a MAC / UUID.
 */
export function opaquePeerToken(deviceId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < deviceId.length; i += 1) {
    hash ^= deviceId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `p${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function looksLikeEphemeralDiscoveryLabel(value: string): boolean {
  return /^[a-z0-9]{6,8}$/i.test(value.trim());
}
