import {
  CryptoDigestAlgorithm,
  CryptoEncoding,
  digestStringAsync,
  getRandomValues,
  randomUUID,
} from 'expo-crypto';

/**
 * ESM libsodium-wrappers throws at import if crypto.getRandomValues is missing.
 * Must load before @hop/protocol. Uses expo-crypto native CSPRNG, not Math.random.
 *
 * Hermes does not implement crypto.randomUUID or crypto.subtle. Install
 * getRandomValues, randomUUID, and digestStringAsync (SHA-256) from the
 * expo-crypto module already in the development-client IPA.
 * Do not return early just because getRandomValues already exists.
 */
function installNamedMethod(obj: object, key: string, value: unknown): void {
  const target = obj as Record<string, unknown>;
  try {
    target[key] = value;
  } catch {
    /* native Crypto objects may reject assignment */
  }
  if (target[key] !== value) {
    Object.defineProperty(obj, key, { value, configurable: true, writable: true });
  }
}

function hopDigestStringAsync(
  algorithm: string,
  data: string,
  options?: { encoding?: string },
): Promise<string> {
  if (algorithm !== CryptoDigestAlgorithm.SHA256 && algorithm !== 'SHA-256') {
    return Promise.reject(new Error(`Unsupported digest algorithm: ${algorithm}`));
  }
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, data, {
    encoding: (options?.encoding as CryptoEncoding | undefined) ?? CryptoEncoding.HEX,
  });
}

function installSecureCrypto(): void {
  if (typeof getRandomValues !== 'function') {
    throw new Error('CSPRNG getRandomValues is unavailable on this runtime');
  }
  if (typeof digestStringAsync !== 'function') {
    throw new Error('SHA-256 digestStringAsync is unavailable on this runtime');
  }
  const existing = globalThis.crypto;
  const cryptoObj = (existing ?? {}) as Crypto;
  if (typeof cryptoObj.getRandomValues !== 'function') {
    installNamedMethod(cryptoObj, 'getRandomValues', getRandomValues);
  }
  if (typeof cryptoObj.randomUUID !== 'function' && typeof randomUUID === 'function') {
    installNamedMethod(cryptoObj, 'randomUUID', randomUUID);
  }
  const hopCrypto = cryptoObj as Crypto & { digestStringAsync?: typeof hopDigestStringAsync };
  if (typeof hopCrypto.digestStringAsync !== 'function') {
    installNamedMethod(cryptoObj, 'digestStringAsync', hopDigestStringAsync);
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
