import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { writeIdentityOwner, generateIdentityKeyPair } from '@hop/protocol';

import { api, type User } from '@/src/api/hop';
import {
  existingInstallSkipsOnboarding,
  registerDeviceIdentity,
  resetLocalHopOnThisDevice,
  restoreExistingSession,
} from '@/src/auth/deviceOnboarding';
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
  resetThisDevice: () => Promise<void>;
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

      const restored = await restoreExistingSession(
        identityBackend,
        deviceApi,
        stored.user,
        stored.token,
        (sessionToken) => api.me(sessionToken),
      );
      if (restored && !cancelled) {
        setToken(restored.token);
        setUser(restored.user);
        setSkipOnboarding(true);
        await saveSession(restored.token, restored.user);
        await writeIdentityOwner(restored.user.id, identityBackend);
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
        const result = await restoreExistingSession(
          identityBackend,
          deviceApi,
          stored.user,
          stored.token,
          (sessionToken) => api.me(sessionToken),
        );
        if (!result) throw new Error('This device has no restored HOP identity.');
        clearProfilePhotoCache();
        await saveSession(result.token, result.user);
        setToken(result.token);
        setUser(result.user);
        setSkipOnboarding(true);
      },
      /** Backend migration/recovery only — not shown in the consumer HOP UI. */
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
      /** Backend migration/recovery only — not shown in the consumer HOP UI. */
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
      async resetThisDevice() {
        if (token) {
          try {
            await api.logout(token);
          } catch {
            /* still clear locally — do not delete the server user */
          }
        }
        await resetLocalHopOnThisDevice(identityBackend);
        clearProfilePhotoCache();
        await saveSession(null, null);
        setToken(null);
        setUser(null);
        setSkipOnboarding(false);
        setError(null);
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
