import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { writeIdentityOwner, generateIdentityKeyPair } from '@hop/protocol';

import { ApiError, api, type User } from '@/src/api/hop';
import { existingInstallSkipsOnboarding, reconnectExistingIdentity, registerDeviceIdentity } from '@/src/auth/deviceOnboarding';
import { loadSession, saveSession } from '@/src/auth/storage';
import { identityBackend } from '@/src/crypto/identity';
import { clearProfilePhotoCache } from '@/src/profile/profilePhotoCache';

type AuthState = {
  ready: boolean;
  token: string | null;
  user: User | null;
  error: string | null;
  skipOnboarding: boolean;
  startHopping: (username: string) => Promise<User>;
  continueOnDevice: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  changeHandle: (username: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const deviceApi = {
  registerDevice: api.registerDevice,
  deviceLogin: api.deviceLogin,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipOnboarding, setSkipOnboarding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadSession();
      const skip = await existingInstallSkipsOnboarding(identityBackend, Boolean(stored.user));
      if (!cancelled) setSkipOnboarding(skip);

      if (stored.user?.id) {
        await writeIdentityOwner(stored.user.id, identityBackend);
      }

      if (stored.token) {
        try {
          const me = await api.me(stored.token);
          if (!cancelled) {
            setToken(stored.token);
            setUser(me);
            setSkipOnboarding(true);
          }
          await saveSession(stored.token, me);
          await writeIdentityOwner(me.id, identityBackend);
          return;
        } catch (err) {
          if (err instanceof ApiError && err.status === 401) {
            const reconnected = await reconnectExistingIdentity(identityBackend, deviceApi, stored.user).catch(
              () => null,
            );
            if (reconnected) {
              if (!cancelled) {
                setToken(reconnected.token);
                setUser(reconnected.user);
                setSkipOnboarding(true);
              }
              await saveSession(reconnected.token, reconnected.user);
              return;
            }
            if (stored.user) {
              if (!cancelled) {
                setToken(null);
                setUser(stored.user);
                setSkipOnboarding(true);
              }
              await saveSession(null, stored.user);
              return;
            }
            await saveSession(null, null);
          } else if (stored.user) {
            if (!cancelled) {
              setToken(stored.token);
              setUser(stored.user);
              setSkipOnboarding(true);
            }
            return;
          } else {
            await saveSession(null, null);
          }
        } finally {
          /* ready set below */
        }
      } else if (skip) {
        const reconnected = await reconnectExistingIdentity(identityBackend, deviceApi, stored.user).catch(() => null);
        if (reconnected) {
          if (!cancelled) {
            setToken(reconnected.token);
            setUser(reconnected.user);
            setSkipOnboarding(true);
          }
          await saveSession(reconnected.token, reconnected.user);
          return;
        }
        if (stored.user && !cancelled) {
          setUser(stored.user);
        }
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
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
      skipOnboarding,
      async startHopping(username) {
        setError(null);
        const result = await registerDeviceIdentity(identityBackend, deviceApi, username, generateIdentityKeyPair);
        clearProfilePhotoCache();
        await saveSession(result.token, result.user);
        setToken(result.token);
        setUser(result.user);
        setSkipOnboarding(true);
        return result.user;
      },
      async continueOnDevice() {
        setError(null);
        const stored = await loadSession();
        const result = await reconnectExistingIdentity(identityBackend, deviceApi, stored.user);
        if (!result) throw new Error('This device has no restored session. Use your existing account login.');
        clearProfilePhotoCache();
        await saveSession(result.token, result.user);
        setToken(result.token);
        setUser(result.user);
        setSkipOnboarding(true);
      },
      async login(username, password) {
        setError(null);
        const result = await api.login(username, password);
        clearProfilePhotoCache();
        await saveSession(result.token, result.user);
        await writeIdentityOwner(result.user.id, identityBackend);
        setToken(result.token);
        setUser(result.user);
        setSkipOnboarding(true);
      },
      async register(username, password) {
        setError(null);
        const result = await api.register(username, password);
        clearProfilePhotoCache();
        await saveSession(result.token, result.user);
        await writeIdentityOwner(result.user.id, identityBackend);
        setToken(result.token);
        setUser(result.user);
        setSkipOnboarding(true);
      },
      async changeHandle(username) {
        if (!token) throw new Error('Not signed in');
        const me = await api.putHandle(token, username);
        await saveSession(token, me);
        setUser(me);
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
        await saveSession(null, user);
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
    [ready, token, user, error, skipOnboarding],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
