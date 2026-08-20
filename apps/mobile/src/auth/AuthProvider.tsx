import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ApiError, api, type User } from '@/src/api/hop';
import { loadSession, saveSession } from '@/src/auth/storage';
import { clearProfilePhotoCache } from '@/src/profile/profilePhotoCache';

type AuthState = {
  ready: boolean;
  token: string | null;
  user: User | null;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadSession();
      if (!stored.token) {
        if (!cancelled) setReady(true);
        return;
      }
      try {
        const me = await api.me(stored.token);
        if (!cancelled) {
          setToken(stored.token);
          setUser(me);
        }
        await saveSession(stored.token, me);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await saveSession(null, null);
        } else if (stored.user) {
          if (!cancelled) {
            setToken(stored.token);
            setUser(stored.user);
          }
        } else {
          await saveSession(null, null);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      token,
      user,
      error,
      async login(username, password) {
        setError(null);
        const result = await api.login(username, password);
        clearProfilePhotoCache();
        await saveSession(result.token, result.user);
        setToken(result.token);
        setUser(result.user);
      },
      async register(username, password) {
        setError(null);
        const result = await api.register(username, password);
        clearProfilePhotoCache();
        await saveSession(result.token, result.user);
        setToken(result.token);
        setUser(result.user);
      },
      async logout() {
        if (token) {
          try {
            await api.logout(token);
          } catch {
            /* still clear locally */
          }
        }
        clearProfilePhotoCache();
        await saveSession(null, null);
        setToken(null);
        setUser(null);
      },
      async refreshUser() {
        if (!token) return;
        const me = await api.me(token);
        await saveSession(token, me);
        setUser(me);
      },
    }),
    [ready, token, user, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
