const PREFIX = 'hop.relay.consent.';

async function read(key: string): Promise<string | null> {
  try {
    const SecureStore = await import('expo-secure-store');
    const value = await SecureStore.getItemAsync(key);
    if (value) return value;
  } catch {
    /* optional */
  }
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  } catch {
    /* ignore */
  }
  return null;
}

async function write(key: string, value: string): Promise<void> {
  try {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* ignore */
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export async function loadRelayConsent(userId: string): Promise<boolean> {
  const stored = await read(`${PREFIX}${userId}`);
  return stored === '1';
}

export async function saveRelayConsent(userId: string, enabled: boolean): Promise<void> {
  await write(`${PREFIX}${userId}`, enabled ? '1' : '0');
}
