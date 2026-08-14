import type { User } from '@/src/api/hop';

const TOKEN_KEY = 'hop.token';
const USER_KEY = 'hop.user';

type Session = { token: string | null; user: User | null };

let memory: Session = { token: null, user: null };

async function read(key: string): Promise<string | null> {
  try {
    const SecureStore = await import('expo-secure-store');
    const value = await SecureStore.getItemAsync(key);
    if (value) return value;
  } catch {
    /* native module optional */
  }
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function write(key: string, value: string | null): Promise<void> {
  try {
    const SecureStore = await import('expo-secure-store');
    if (value) await SecureStore.setItemAsync(key, value);
    else await SecureStore.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
  try {
    if (typeof localStorage !== 'undefined') {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

export async function loadSession(): Promise<Session> {
  if (memory.token && memory.user) return memory;
  const token = memory.token ?? (await read(TOKEN_KEY));
  const rawUser = await read(USER_KEY);
  let user: User | null = memory.user;
  if (rawUser) {
    try {
      user = JSON.parse(rawUser) as User;
    } catch {
      user = null;
    }
  }
  memory = { token, user };
  return memory;
}

export async function saveSession(token: string | null, user: User | null): Promise<void> {
  memory = { token, user };
  await write(TOKEN_KEY, token);
  await write(USER_KEY, user ? JSON.stringify(user) : null);
}

export async function loadToken(): Promise<string | null> {
  const session = await loadSession();
  return session.token;
}

export async function saveToken(token: string | null): Promise<void> {
  await saveSession(token, token ? memory.user : null);
}
