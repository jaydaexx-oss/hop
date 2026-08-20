import { describe, expect, it } from 'vitest';

import {
  generateIdentityKeyPair,
  loadOrCreateIdentity,
  peekStoredIdentity,
  writeIdentityOwner,
  type SecretBackend,
} from '@hop/protocol';

import { existingInstallSkipsOnboarding, reconnectExistingIdentity, registerDeviceIdentity } from './deviceOnboarding';

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
          user: {
            id: 'user-1',
            username,
            created_at: '2026-01-01T00:00:00Z',
            identity_public_key: publicKey,
          },
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
      registerDeviceIdentity(backend, {
        registerDevice: async () => {
          throw new Error('must not create a second server user');
        },
        deviceLogin: async () => {
          throw new Error('no');
        },
      }, 'ada2', async () => firstPair),
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
          user: {
            id: 'user-1',
            username: 'ada',
            created_at: '2026-01-01T00:00:00Z',
            identity_public_key: pair.publicKey,
          },
        }),
      },
      { id: 'user-1', username: 'ada', created_at: '2026-01-01T00:00:00Z' },
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
            user: {
              id: 'user-OTHER',
              username: 'mallory',
              created_at: '2026-01-01T00:00:00Z',
            },
          }),
        },
        { id: 'user-1', username: 'ada', created_at: '2026-01-01T00:00:00Z' },
      ),
    ).rejects.toMatchObject({ name: 'IdentityError' });
  });
});
