import { getRandomValues } from 'expo-crypto';

/**
 * ESM libsodium-wrappers throws at import if crypto.getRandomValues is missing.
 * Must load before @hop/protocol. Uses expo-crypto native CSPRNG, not Math.random.
 */
function installSecureGetRandomValues(): void {
  if (typeof getRandomValues !== 'function') {
    throw new Error('CSPRNG getRandomValues is unavailable on this runtime');
  }
  const existing = globalThis.crypto;
  if (existing && typeof existing.getRandomValues === 'function') {
    return;
  }
  const cryptoObj = (existing ?? {}) as Crypto;
  cryptoObj.getRandomValues = getRandomValues as Crypto['getRandomValues'];
  if (!existing) {
    Object.defineProperty(globalThis, 'crypto', {
      value: cryptoObj,
      configurable: true,
      writable: true,
    });
  }
}

installSecureGetRandomValues();
