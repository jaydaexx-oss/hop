import { getRandomValues, randomUUID } from 'expo-crypto';

/**
 * ESM libsodium-wrappers throws at import if crypto.getRandomValues is missing.
 * Must load before @hop/protocol. Uses expo-crypto native CSPRNG, not Math.random.
 *
 * Hermes does not implement crypto.randomUUID. Install both getRandomValues and
 * randomUUID from the expo-crypto module already in the development-client IPA.
 * Do not return early just because getRandomValues already exists.
 */
function installCryptoMethod<K extends keyof Crypto>(cryptoObj: Crypto, key: K, value: Crypto[K]): void {
  try {
    cryptoObj[key] = value;
  } catch {
    /* native Crypto objects may reject assignment */
  }
  if (cryptoObj[key] !== value) {
    Object.defineProperty(cryptoObj, key, { value, configurable: true, writable: true });
  }
}

function installSecureCrypto(): void {
  if (typeof getRandomValues !== 'function') {
    throw new Error('CSPRNG getRandomValues is unavailable on this runtime');
  }
  const existing = globalThis.crypto;
  const cryptoObj = (existing ?? {}) as Crypto;
  if (typeof cryptoObj.getRandomValues !== 'function') {
    installCryptoMethod(cryptoObj, 'getRandomValues', getRandomValues as Crypto['getRandomValues']);
  }
  if (typeof cryptoObj.randomUUID !== 'function' && typeof randomUUID === 'function') {
    installCryptoMethod(cryptoObj, 'randomUUID', randomUUID as Crypto['randomUUID']);
  }
  if (!existing) {
    Object.defineProperty(globalThis, 'crypto', {
      value: cryptoObj,
      configurable: true,
      writable: true,
    });
  }
}

installSecureCrypto();
