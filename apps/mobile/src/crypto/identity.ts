import {
  generateIdentityKeyPair,
  type IdentityKeyPair,
} from '@hop/protocol';

const PREFIX = 'hop.box.';

async function read(key: string): Promise<string | null> {
  try {
    const SecureStore = await import('expo-secure-store');
    const value = await SecureStore.getItemAsync(key);
    if (value) return value;
  } catch {
    /* optional native module */
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

export async function loadOrCreateIdentity(userId: string): Promise<IdentityKeyPair> {
  const stored = await read(`${PREFIX}${userId}`);
  if (stored) {
    const parsed = JSON.parse(stored) as IdentityKeyPair;
    if (parsed.publicKey && parsed.secretKey) return parsed;
  }
  const pair = await generateIdentityKeyPair();
  await write(`${PREFIX}${userId}`, JSON.stringify(pair));
  return pair;
}
