import type { User } from '@/src/api/hop';
import { readSecret, writeSecret } from '@/src/crypto/secretStore';

const TOKEN_KEY = 'hop.token';
const USER_KEY = 'hop.user';

type Session = { token: string | null; user: User | null };

let memory: Session = { token: null, user: null };

export async function loadSession(): Promise<Session> {
  if (memory.token && memory.user) return memory;
  const token = memory.token ?? (await readSecret(TOKEN_KEY));
  const rawUser = await readSecret(USER_KEY);
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
  await writeSecret(TOKEN_KEY, token);
  await writeSecret(USER_KEY, user ? JSON.stringify(user) : null);
}

export async function loadToken(): Promise<string | null> {
  const session = await loadSession();
  return session.token;
}

export async function saveToken(token: string | null): Promise<void> {
  await saveSession(token, token ? memory.user : null);
}
