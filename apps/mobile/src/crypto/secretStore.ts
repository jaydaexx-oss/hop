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

/** Persist secrets in SecureStore/Keychain only. Never localStorage. */
export async function readSecret(key: string): Promise<string | null> {
  const store = await nativeStore();
  if (store) {
    try {
      const value = await store.getItemAsync(key);
      if (value) return value;
    } catch {
      /* fall through to memory */
    }
  }
  return memory.get(key) ?? null;
}

export async function writeSecret(key: string, value: string | null): Promise<void> {
  const store = await nativeStore();
  if (store) {
    try {
      if (value) await store.setItemAsync(key, value);
      else await store.deleteItemAsync(key);
    } catch {
      /* memory-only fallback */
    }
  }
  if (value) memory.set(key, value);
  else memory.delete(key);
}
