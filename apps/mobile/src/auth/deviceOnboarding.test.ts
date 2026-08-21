import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  createCsprngUuid,
  generateIdentityKeyPair,
  HANDLE_HINT_KEY,
  hashedInstallHeaderValue,
  loadOrCreateDeviceSecret,
  loadOrCreateIdentity,
  loadOrCreateInstallId,
  peekDeviceSecret,
  peekStoredIdentity,
  readHandleHint,
  readIdentityOwner,
  sha256Hex,
  shouldAutoStartRecoveryFromHandleHint,
  writeIdentityOwner,
  type NonSecretStore,
  type SecretBackend,
} from '@hop/protocol';

import {
  existingInstallSkipsOnboarding,
  recoverHopAccount,
  reconnectExistingIdentity,
  registerDeviceIdentity,
  resetLocalHopOnThisDevice,
  restoreExistingSession,
} from './deviceOnboarding';

function memoryBackend(): SecretBackend & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async read(key) {
      return map.get(key) ?? null;
    },
    async write(key, value) {
      if (value) map.set(key, value);
      else map.delete(key);
    },
  };
}

function memoryHintStore(): NonSecretStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async read(key) {
      return map.get(key) ?? null;
    },
    async write(key, value) {
      if (value) map.set(key, value);
      else map.delete(key);
    },
  };
}

function user(id: string, username: string, publicKey?: string) {
  return {
    id,
    username,
    created_at: '2026-01-01T00:00:00Z',
    identity_public_key: publicKey,
  };
}

describe('device onboarding does not orphan existing identity', () => {
  it('registers once, binds the same keypair to the server user_id, and skips a second generate', async () => {
    const backend = memoryBackend();
    let generated = 0;
    const generate = async () => {
      generated += 1;
      return generateIdentityKeyPair();
    };
    const firstPair = await generate();
    generated = 0;
    const generateOnce = async () => {
      generated += 1;
      if (generated > 1) throw new Error('must not generate a second identity');
      return firstPair;
    };
    const result = await registerDeviceIdentity(
      backend,
      {
        registerDevice: async (username, publicKey) => ({
          token: 'tok-1',
          user: user('user-1', username, publicKey),
        }),
        deviceLogin: async () => {
          throw new Error('should not device-login on first register');
        },
      },
      'ada',
      generateOnce,
    );
    expect(result.user.id).toBe('user-1');
    expect(generated).toBe(1);
    expect(await peekStoredIdentity('user-1', backend)).toEqual(firstPair);
    expect(await existingInstallSkipsOnboarding(backend, false)).toBe(true);
    await expect(
      registerDeviceIdentity(
        backend,
        {
          registerDevice: async () => {
            throw new Error('must not create a second server user');
          },
          deviceLogin: async () => {
            throw new Error('no');
          },
        },
        'ada2',
        async () => firstPair,
      ),
    ).rejects.toMatchObject({ name: 'IdentityError' });
  });

  it('reconnects with the same user_id and refuses a swapped account', async () => {
    const backend = memoryBackend();
    const pair = await generateIdentityKeyPair();
    await loadOrCreateIdentity('user-1', backend, async () => pair);
    await writeIdentityOwner('user-1', backend);
    await backend.write('hop.device.secret', 'd'.repeat(32));
    const ok = await reconnectExistingIdentity(
      backend,
      {
        registerDevice: async () => {
          throw new Error('must not register');
        },
        deviceLogin: async () => ({
          token: 'tok-2',
          user: user('user-1', 'ada', pair.publicKey),
        }),
      },
      user('user-1', 'ada'),
    );
    expect(ok?.user.id).toBe('user-1');

    await expect(
      reconnectExistingIdentity(
        backend,
        {
          registerDevice: async () => {
            throw new Error('must not register');
          },
          deviceLogin: async () => ({
            token: 'tok-evil',
            user: user('user-OTHER', 'mallory'),
          }),
        },
        user('user-1', 'ada'),
      ),
    ).rejects.toMatchObject({ name: 'IdentityError' });
  });
});

describe('returning-user restore and local reset', () => {
  it('reuses a valid session token on restart and never mints a new identity', async () => {
    const backend = memoryBackend();
    const pair = await generateIdentityKeyPair();
    await loadOrCreateIdentity('user-1', backend, async () => pair);
    await writeIdentityOwner('user-1', backend);
    await backend.write('hop.device.secret', 'd'.repeat(32));
    let registered = 0;
    let deviceLogins = 0;
    const restored = await restoreExistingSession(
      backend,
      {
        registerDevice: async () => {
          registered += 1;
          throw new Error('must not register on restart');
        },
        deviceLogin: async () => {
          deviceLogins += 1;
          throw new Error('must not device-login when the session is still valid');
        },
      },
      user('user-1', 'ada', pair.publicKey),
      'live-token',
      async () => user('user-1', 'ada', pair.publicKey),
    );
    expect(restored).toEqual({ token: 'live-token', user: user('user-1', 'ada', pair.publicKey) });
    expect(registered).toBe(0);
    expect(deviceLogins).toBe(0);
    expect(await peekStoredIdentity('user-1', backend)).toEqual(pair);
  });

  it('silently POSTs /auth/device when the session expired but the device secret is valid', async () => {
    const backend = memoryBackend();
    const pair = await generateIdentityKeyPair();
    await loadOrCreateIdentity('user-1', backend, async () => pair);
    await writeIdentityOwner('user-1', backend);
    await backend.write('hop.device.secret', 'd'.repeat(32));
    const restored = await restoreExistingSession(
      backend,
      {
        registerDevice: async () => {
          throw new Error('must not register');
        },
        deviceLogin: async (secret) => {
          expect(secret).toBe('d'.repeat(32));
          return { token: 'fresh-token', user: user('user-1', 'ada', pair.publicKey) };
        },
      },
      user('user-1', 'ada', pair.publicKey),
      'expired-token',
      async () => {
        throw Object.assign(new Error('unauthorized'), { status: 401 });
      },
    );
    expect(restored?.token).toBe('fresh-token');
    expect(restored?.user.id).toBe('user-1');
    expect(await readIdentityOwner(backend)).toBe('user-1');
  });

  it('restores from device_secret alone when hop.user is missing after an old logout', async () => {
    const backend = memoryBackend();
    const pair = await generateIdentityKeyPair();
    await loadOrCreateIdentity('user-1', backend, async () => pair);
    await writeIdentityOwner('user-1', backend);
    await backend.write('hop.device.secret', 'd'.repeat(32));
    const restored = await restoreExistingSession(
      backend,
      {
        registerDevice: async () => {
          throw new Error('must not register');
        },
        deviceLogin: async () => ({ token: 'tok-3', user: user('user-1', 'ada', pair.publicKey) }),
      },
      null,
      null,
      async () => {
        throw new Error('no leftover session');
      },
    );
    expect(restored?.token).toBe('tok-3');
    expect(restored?.user.id).toBe('user-1');
  });

  it('reset wipes local identity so onboarding can mint a new device identity', async () => {
    const backend = memoryBackend();
    const firstPair = await generateIdentityKeyPair();
    const secondPair = await generateIdentityKeyPair();
    await loadOrCreateIdentity('user-1', backend, async () => firstPair);
    await writeIdentityOwner('user-1', backend);
    await loadOrCreateDeviceSecret(backend);
    const installId = await loadOrCreateInstallId(backend);
    const installHeader = await hashedInstallHeaderValue(backend);

    await resetLocalHopOnThisDevice(backend);

    expect(await readIdentityOwner(backend)).toBeNull();
    expect(await peekDeviceSecret(backend)).toBeNull();
    expect(await peekStoredIdentity('user-1', backend)).toBeNull();
    expect(await existingInstallSkipsOnboarding(backend, false)).toBe(false);
    expect(await loadOrCreateInstallId(backend)).toBe(installId);

    let generated = 0;
    let seenHeader: string | undefined;
    const next = await registerDeviceIdentity(
      backend,
      {
        registerDevice: async (username, publicKey, _secret, header) => {
          expect(username).toBe('ada2');
          expect(publicKey).toBe(secondPair.publicKey);
          seenHeader = header;
          return { token: 'tok-new', user: user('user-2', username, publicKey) };
        },
        deviceLogin: async () => {
          throw new Error('must not device-login during first-launch after reset');
        },
      },
      'ada2',
      async () => {
        generated += 1;
        return secondPair;
      },
    );
    expect(generated).toBe(1);
    expect(seenHeader).toBe(installHeader);
    expect(next.user.id).toBe('user-2');
    expect(await peekStoredIdentity('user-1', backend)).toBeNull();
    expect(await peekStoredIdentity('user-2', backend)).toEqual(secondPair);
  });

  it('reset stores a handle hint, clears keys/session, and does not recover from the hint', async () => {
    const backend = memoryBackend();
    const hintStore = memoryHintStore();
    const pair = await generateIdentityKeyPair();
    await loadOrCreateIdentity('user-1', backend, async () => pair);
    await writeIdentityOwner('user-1', backend);
    await loadOrCreateDeviceSecret(backend);

    await resetLocalHopOnThisDevice(backend, { store: hintStore, lastHandle: 'Ada' });

    expect(await readHandleHint(hintStore)).toBe('ada');
    expect(hintStore.map.get(HANDLE_HINT_KEY)).toBe('ada');
    expect(JSON.stringify([...hintStore.map.entries()])).not.toMatch(/user-1|live-token|secretKey|publicKey/);
    expect(await readIdentityOwner(backend)).toBeNull();
    expect(await peekDeviceSecret(backend)).toBeNull();
    expect(await peekStoredIdentity('user-1', backend)).toBeNull();
    expect(await existingInstallSkipsOnboarding(backend, false)).toBe(false);
    expect(shouldAutoStartRecoveryFromHandleHint()).toBe(false);

    const nextPair = await generateIdentityKeyPair();
    const next = await registerDeviceIdentity(
      backend,
      {
        registerDevice: async (username, publicKey) => ({
          token: 'tok-new',
          user: user('user-2', username, publicKey),
        }),
        deviceLogin: async () => {
          throw new Error('must not device-login from a handle hint');
        },
      },
      'ada2',
      async () => nextPair,
    );
    expect(next.user.id).toBe('user-2');
    expect(await peekStoredIdentity('user-1', backend)).toBeNull();
    expect(await peekStoredIdentity('user-2', backend)).toEqual(nextPair);
    expect(await readHandleHint(hintStore)).toBe('ada');
  });

  it('clears the handle hint for a different handle without bypassing install rate limits', async () => {
    const backend = memoryBackend();
    const hintStore = memoryHintStore();
    const firstPair = await generateIdentityKeyPair();
    await loadOrCreateIdentity('user-1', backend, async () => firstPair);
    await writeIdentityOwner('user-1', backend);
    await loadOrCreateDeviceSecret(backend);
    const installHeader = await hashedInstallHeaderValue(backend);

    await resetLocalHopOnThisDevice(backend, { store: hintStore, lastHandle: 'ada' });
    expect(await readHandleHint(hintStore)).toBe('ada');
    await hintStore.write(HANDLE_HINT_KEY, null);
    expect(await readHandleHint(hintStore)).toBeNull();
    expect(await existingInstallSkipsOnboarding(backend, false)).toBe(false);

    const secondPair = await generateIdentityKeyPair();
    let seenHeader: string | undefined;
    await registerDeviceIdentity(
      backend,
      {
        registerDevice: async (username, publicKey, _secret, header) => {
          expect(username).toBe('bob');
          seenHeader = header;
          return { token: 'tok-bob', user: user('user-2', username, publicKey) };
        },
        deviceLogin: async () => {
          throw new Error('must not device-login');
        },
      },
      'bob',
      async () => secondPair,
    );
    expect(seenHeader).toBe(installHeader);
  });

  it('shows normal onboarding when no handle hint is remembered', async () => {
    const backend = memoryBackend();
    const hintStore = memoryHintStore();
    await resetLocalHopOnThisDevice(backend, { store: hintStore, lastHandle: null });
    expect(await readHandleHint(hintStore)).toBeNull();
    expect(await existingInstallSkipsOnboarding(backend, false)).toBe(false);
  });

  it('sends SHA-256 X-Hop-Install when crypto.subtle is missing', async () => {
    const cryptoObj = globalThis.crypto as Crypto & {
      digestStringAsync?: (algorithm: string, data: string) => Promise<string>;
    };
    const originalSubtle = cryptoObj.subtle;
    const originalDigest = cryptoObj.digestStringAsync;
    Object.defineProperty(cryptoObj, 'subtle', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(cryptoObj, 'digestStringAsync', {
      value: async (algorithm: string, data: string) => {
        expect(algorithm).toBe('SHA-256');
        return createHash('sha256').update(data, 'utf8').digest('hex');
      },
      configurable: true,
      writable: true,
    });
    try {
      expect(globalThis.crypto.subtle).toBeUndefined();
      const backend = memoryBackend();
      const pair = await generateIdentityKeyPair();
      let seenHeader: string | undefined;
      await registerDeviceIdentity(
        backend,
        {
          registerDevice: async (_username, _publicKey, _secret, header) => {
            seenHeader = header;
            return { token: 'tok-1', user: user('user-1', 'ada', pair.publicKey) };
          },
          deviceLogin: async () => {
            throw new Error('should not device-login on first register');
          },
        },
        'ada',
        async () => pair,
      );
      const installId = await loadOrCreateInstallId(backend);
      expect(seenHeader).toBe(createHash('sha256').update(installId, 'utf8').digest('hex'));
      expect(seenHeader).toMatch(/^[0-9a-f]{64}$/);
      expect(await sha256Hex(installId)).toBe(seenHeader);
      expect(await hashedInstallHeaderValue(backend)).toBe(seenHeader);
    } finally {
      Object.defineProperty(cryptoObj, 'subtle', {
        value: originalSubtle,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(cryptoObj, 'digestStringAsync', {
        value: originalDigest,
        configurable: true,
        writable: true,
      });
    }
  });
});

describe('recover my HOP on a new install', () => {
  it('restores the same user_id when Keychain already has the original pair', async () => {
    const backend = memoryBackend();
    const pair = await generateIdentityKeyPair();
    await loadOrCreateIdentity('user-jay', backend, async () => pair);
    backend.map.delete('hop.identity.userId');

    const restored = await recoverHopAccount(
      backend,
      {
        recoverPassword: async (username, password) => {
          expect(username).toBe('jaydae');
          expect(password).toBe('ok-secret');
          return { token: 'rec-tok', user: user('user-jay', 'jaydae', pair.publicKey) };
        },
        passkeyAuthenticate: async () => {
          throw new Error('passkey not used');
        },
        bindRecoveredDevice: async (_token, secret) => {
          expect(secret.length).toBeGreaterThanOrEqual(32);
          return { token: 'bound-tok', user: user('user-jay', 'jaydae', pair.publicKey) };
        },
        logout: async () => undefined,
        getIdentityWrap: async () => {
          const err = Object.assign(new Error('not found'), { status: 404, name: 'ApiError' });
          throw err;
        },
        putIdentityWrap: async () => undefined,
      },
      'jaydae',
      { method: 'legacy_password_once', password: 'ok-secret' },
    );
    expect(restored.user.id).toBe('user-jay');
    expect(await peekStoredIdentity('user-jay', backend)).toEqual(pair);
    expect(await readIdentityOwner(backend)).toBe('user-jay');
  });

  it('recovers and mints CSPRNG UUIDs when crypto.randomUUID is missing', async () => {
    const cryptoObj = globalThis.crypto;
    const original = cryptoObj.randomUUID;
    Object.defineProperty(cryptoObj, 'randomUUID', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      expect(typeof globalThis.crypto.getRandomValues).toBe('function');
      expect(createCsprngUuid()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(await loadOrCreateInstallId(memoryBackend())).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      const backend = memoryBackend();
      const pair = await generateIdentityKeyPair();
      await loadOrCreateIdentity('user-jay', backend, async () => pair);
      backend.map.delete('hop.identity.userId');
      const restored = await recoverHopAccount(
        backend,
        {
          recoverPassword: async () => {
            throw new Error('password not used');
          },
          passkeyAuthenticate: async () => ({
            token: 'rec-tok',
            user: user('user-jay', 'jaydae', pair.publicKey),
          }),
          bindRecoveredDevice: async (_token, secret) => {
            expect(secret.length).toBeGreaterThanOrEqual(32);
            return { token: 'bound-tok', user: user('user-jay', 'jaydae', pair.publicKey) };
          },
          logout: async () => undefined,
          getIdentityWrap: async () => {
            throw Object.assign(new Error('not found'), { status: 404, name: 'ApiError' });
          },
          putIdentityWrap: async () => undefined,
        },
        'jaydae',
        { method: 'passkey' },
      );
      expect(restored.user.id).toBe('user-jay');
      expect(await peekStoredIdentity('user-jay', backend)).toEqual(pair);
    } finally {
      Object.defineProperty(cryptoObj, 'randomUUID', {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });

  it('does not register when recovery fails', async () => {
    const backend = memoryBackend();
    await expect(
      recoverHopAccount(
        backend,
        {
          recoverPassword: async () => {
            throw Object.assign(new Error('Invalid username or password'), { status: 401 });
          },
          passkeyAuthenticate: async () => {
            throw new Error('no');
          },
          bindRecoveredDevice: async () => {
            throw new Error('must not bind');
          },
          logout: async () => undefined,
          getIdentityWrap: async () => {
            throw new Error('no wrap');
          },
          putIdentityWrap: async () => undefined,
        },
        'jaydae',
        { method: 'legacy_password_once', password: 'wrong' },
      ),
    ).rejects.toThrow(/Invalid username or password/);
    expect(await readIdentityOwner(backend)).toBeNull();
    expect(await peekStoredIdentity('user-jay', backend)).toBeNull();
  });

  it('does not mint keys when Keychain is empty after a successful password proof', async () => {
    const backend = memoryBackend();
    const server = await generateIdentityKeyPair();
    await expect(
      recoverHopAccount(
        backend,
        {
          recoverPassword: async () => ({
            token: 'rec-tok',
            user: user('user-jay', 'jaydae', server.publicKey),
          }),
          passkeyAuthenticate: async () => {
            throw new Error('no');
          },
          bindRecoveredDevice: async () => {
            throw new Error('must not bind without keys');
          },
          logout: async () => undefined,
          getIdentityWrap: async () => {
            throw Object.assign(new Error('not found'), { status: 404 });
          },
          putIdentityWrap: async () => undefined,
        },
        'jaydae',
        { method: 'legacy_password_once', password: 'ok-secret' },
      ),
    ).rejects.toMatchObject({ code: 'KEYS_MISSING' });
    expect(await peekStoredIdentity('user-jay', backend)).toBeNull();
    expect(await readIdentityOwner(backend)).toBeNull();
    expect(await peekDeviceSecret(backend)).toBeNull();
  });
});
