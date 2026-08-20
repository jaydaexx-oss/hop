import { describe, expect, it } from 'vitest';

import {
  generateIdentityKeyPair,
  loadOrCreateDeviceSecret,
  loadOrCreateIdentity,
  peekDeviceSecret,
  peekStoredIdentity,
  readIdentityOwner,
  writeIdentityOwner,
  type SecretBackend,
} from '@hop/protocol';

import {
  existingInstallSkipsOnboarding,
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

    await resetLocalHopOnThisDevice(backend);

    expect(await readIdentityOwner(backend)).toBeNull();
    expect(await peekDeviceSecret(backend)).toBeNull();
    expect(await peekStoredIdentity('user-1', backend)).toBeNull();
    expect(await existingInstallSkipsOnboarding(backend, false)).toBe(false);

    let generated = 0;
    const next = await registerDeviceIdentity(
      backend,
      {
        registerDevice: async (username, publicKey) => {
          expect(username).toBe('ada2');
          expect(publicKey).toBe(secondPair.publicKey);
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
    expect(next.user.id).toBe('user-2');
    expect(await peekStoredIdentity('user-1', backend)).toBeNull();
    expect(await peekStoredIdentity('user-2', backend)).toEqual(secondPair);
  });
});
