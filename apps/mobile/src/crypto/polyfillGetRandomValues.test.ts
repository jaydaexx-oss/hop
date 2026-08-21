import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashedInstallHeaderValue, loadOrCreateInstallId, sha256Hex } from '@hop/protocol';

const EXPO_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

type HopCrypto = Crypto & {
  digestStringAsync?: (algorithm: string, data: string, options?: { encoding?: string }) => Promise<string>;
};

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  getRandomValues: (typedArray: Uint8Array) => {
    for (let i = 0; i < typedArray.length; i++) typedArray[i] = (i * 19 + 5) & 0xff;
    return typedArray;
  },
  randomUUID: () => EXPO_UUID,
  digestStringAsync: async (algorithm: string, data: string) => {
    if (algorithm !== 'SHA-256') throw new Error(`unsupported ${algorithm}`);
    return createHash('sha256').update(data, 'utf8').digest('hex');
  },
}));

describe('expo-crypto CSPRNG polyfill', () => {
  const cryptoObj = globalThis.crypto as HopCrypto;
  const originalRandomUUID = cryptoObj.randomUUID;
  const originalGetRandomValues = cryptoObj.getRandomValues;
  const originalSubtle = cryptoObj.subtle;
  const originalDigestStringAsync = cryptoObj.digestStringAsync;

  afterEach(() => {
    Object.defineProperty(cryptoObj, 'randomUUID', {
      value: originalRandomUUID,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(cryptoObj, 'getRandomValues', {
      value: originalGetRandomValues,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(cryptoObj, 'subtle', {
      value: originalSubtle,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(cryptoObj, 'digestStringAsync', {
      value: originalDigestStringAsync,
      configurable: true,
      writable: true,
    });
    vi.resetModules();
  });

  it('installs expo-crypto randomUUID when Hermes left it missing', async () => {
    Object.defineProperty(cryptoObj, 'randomUUID', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    await import('./polyfillGetRandomValues');
    expect(typeof globalThis.crypto.getRandomValues).toBe('function');
    expect(globalThis.crypto.randomUUID()).toBe(EXPO_UUID);
  });

  it('installs expo-crypto SHA-256 when Hermes left crypto.subtle missing', async () => {
    Object.defineProperty(cryptoObj, 'subtle', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(cryptoObj, 'digestStringAsync', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    await import('./polyfillGetRandomValues');
    expect(globalThis.crypto.subtle).toBeUndefined();
    expect(typeof cryptoObj.digestStringAsync).toBe('function');
    expect(typeof globalThis.crypto.getRandomValues).toBe('function');
    await expect(cryptoObj.digestStringAsync!('SHA-256', 'abc')).resolves.toBe(SHA256_ABC);
    expect(await sha256Hex('abc')).toBe(SHA256_ABC);

    const backend = {
      map: new Map<string, string>(),
      async read(key: string) {
        return this.map.get(key) ?? null;
      },
      async write(key: string, value: string | null) {
        if (value) this.map.set(key, value);
        else this.map.delete(key);
      },
    };
    const installId = await loadOrCreateInstallId(backend);
    const header = await hashedInstallHeaderValue(backend);
    expect(header).toBe(createHash('sha256').update(installId, 'utf8').digest('hex'));
    expect(header).toMatch(/^[0-9a-f]{64}$/);
  });
});
