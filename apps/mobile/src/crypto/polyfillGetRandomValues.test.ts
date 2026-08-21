import { afterEach, describe, expect, it, vi } from 'vitest';

const EXPO_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

vi.mock('expo-crypto', () => ({
  getRandomValues: (typedArray: Uint8Array) => {
    for (let i = 0; i < typedArray.length; i++) typedArray[i] = (i * 19 + 5) & 0xff;
    return typedArray;
  },
  randomUUID: () => EXPO_UUID,
}));

describe('expo-crypto CSPRNG polyfill', () => {
  const cryptoObj = globalThis.crypto;
  const originalRandomUUID = cryptoObj.randomUUID;
  const originalGetRandomValues = cryptoObj.getRandomValues;

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
});
