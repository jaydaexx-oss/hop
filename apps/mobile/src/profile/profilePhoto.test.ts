import { describe, expect, it, vi } from 'vitest';

import {
  PROFILE_PHOTO_MUTATE_PATH,
  avatarAuthHeaders,
  fetchAvatarBytes,
  isMissingAvatarError,
  isMissingAvatarStatus,
  profilePhotoProxyPath,
  shouldFetchAvatar,
} from '@/src/profile/profilePhoto';

const USER_ID = '11111111-2222-3333-4444-555555555555';
const API = 'https://hop-uokqmg.fly.dev';

describe('profile photo URL mapping matches apps/api users router', () => {
  it('GET uses /users/id/{id}/avatar and PUT/DELETE use /users/me/avatar', () => {
    expect(profilePhotoProxyPath(USER_ID)).toBe(`/users/id/${USER_ID}/avatar`);
    expect(PROFILE_PHOTO_MUTATE_PATH).toBe('/users/me/avatar');
    expect(PROFILE_PHOTO_MUTATE_PATH).not.toBe(profilePhotoProxyPath(USER_ID));
  });

  it('sends the caller Bearer token on GET', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`${API}/users/id/${USER_ID}/avatar`);
      expect(init?.method).toBe('GET');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer test-token');
      expect(headers.get('Accept')).toBe('image/jpeg');
      return new Response(JSON.stringify({ detail: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await expect(fetchAvatarBytes(API, 'test-token', USER_ID, fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('GET avatar 404 is empty state, not a load error', () => {
  it('skips GET when has_avatar is explicitly false', () => {
    expect(shouldFetchAvatar(false)).toBe(false);
    expect(shouldFetchAvatar(true)).toBe(true);
    expect(shouldFetchAvatar(undefined)).toBe(true);
  });

  it('treats HTTP 404 as missing, including FastAPI unmatched Not Found', async () => {
    expect(isMissingAvatarStatus(404)).toBe(true);
    expect(isMissingAvatarStatus(401)).toBe(false);
    expect(isMissingAvatarError({ status: 404, message: 'Not Found' })).toBe(true);
    expect(isMissingAvatarError(new Error('Not Found'))).toBe(true);
    expect(isMissingAvatarError(new Error('No profile photo'))).toBe(true);
    expect(isMissingAvatarError(new Error('Not authenticated'))).toBe(false);

    const unmatched = vi.fn(async () => new Response('{"detail":"Not Found"}', { status: 404 }));
    await expect(fetchAvatarBytes(API, 'tok', USER_ID, unmatched)).resolves.toBeNull();

    const noPhoto = vi.fn(async () => new Response('{"detail":"No profile photo"}', { status: 404 }));
    await expect(fetchAvatarBytes(API, 'tok', USER_ID, noPhoto)).resolves.toBeNull();
  });

  it('still surfaces auth failures on GET', async () => {
    const denied = vi.fn(
      async () =>
        new Response(JSON.stringify({ detail: 'Not authenticated' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await expect(fetchAvatarBytes(API, 'tok', USER_ID, denied)).rejects.toMatchObject({
      status: 401,
      message: 'Not authenticated',
    });
  });

  it('returns JPEG bytes when GET succeeds', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const ok = vi.fn(async () => new Response(jpeg, { status: 200, headers: { 'Content-Type': 'image/jpeg' } }));
    const bytes = await fetchAvatarBytes(API, 'tok', USER_ID, ok);
    expect(bytes).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(bytes!)).toEqual(jpeg);
    expect(avatarAuthHeaders('tok').Authorization).toBe('Bearer tok');
  });
});
