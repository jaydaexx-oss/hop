import {
  readWithSecretPolicy,
  shouldFailClosedSecretStore,
  writeWithSecretPolicy,
  type SecretBackend,
} from '@hop/protocol';

const memory = new Map<string, string>();

async function nativeStore(): Promise<typeof import('expo-secure-store') | null> {
  try {
    const SecureStore = await import('expo-secure-store');
    if (typeof SecureStore.getItemAsync === 'function') return SecureStore;
  } catch {
    /* web / tests */
  }
  return null;
}

function failClosed(): boolean {
  // Development client + Metro: __DEV__ is true, so a memory fallback is allowed if
  // SecureStore is missing (web/tests). TestFlight / release must ship with __DEV__ false
  // and NODE_ENV=production so this path fails closed — never weaken that for store builds.
  const isDev = typeof __DEV__ === 'undefined' ? process.env.NODE_ENV !== 'production' : __DEV__;
  return shouldFailClosedSecretStore({
    isDev,
    nodeEnv: process.env.NODE_ENV,
  });
}

async function nativeBackend(): Promise<SecretBackend | null> {
  const store = await nativeStore();
  if (!store) return null;
  return {
    async read(key) {
      return store.getItemAsync(key);
    },
    async write(key, value) {
      if (value) {
        await store.setItemAsync(key, value, {
          // WHEN_UNLOCKED migrates with encrypted iOS backups. Do not use THIS_DEVICE_ONLY
          // for identity material — that would make new-phone recovery impossible.
          keychainAccessible: store.WHEN_UNLOCKED,
        });
      } else await store.deleteItemAsync(key);
    },
  };
}

/** Persist secrets in SecureStore/Keychain only. Production fails closed — never volatile memory. */
export async function readSecret(key: string): Promise<string | null> {
  return readWithSecretPolicy({
    backend: await nativeBackend(),
    memory,
    key,
    failClosed: failClosed(),
  });
}

export async function writeSecret(key: string, value: string | null): Promise<void> {
  await writeWithSecretPolicy({
    backend: await nativeBackend(),
    memory,
    key,
    value,
    failClosed: failClosed(),
  });
}
