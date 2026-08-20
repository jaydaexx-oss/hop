import { describe, expect, it } from 'vitest';
import { encodeHopQrPayload, hopQrUri } from '@hop/protocol';

import { MemoryKvStore } from '@/src/nearby/kvStore';
import {
  defaultLocalAvatarColor,
  loadLocalAvatarColor,
  saveLocalAvatarColor,
} from '@/src/profile/avatarAppearance';
import {
  avatarUriOrFallback,
  isSafeAvatarUrl,
  profilePhotoProxyPath,
} from '@/src/profile/profilePhoto';

describe('local avatar color is presentation only', () => {
  it('stores a local swatch that is not encoded in the HOP QR', async () => {
    const kv = new MemoryKvStore();
    await saveLocalAvatarColor(kv, 'user-1', defaultLocalAvatarColor('user-1'));
    const color = await loadLocalAvatarColor(kv, 'user-1');
    expect(color.startsWith('#')).toBe(true);
    const uri = hopQrUri(encodeHopQrPayload({ username: 'jaydae' }));
    expect(uri).not.toContain(color);
    expect(uri).not.toMatch(/color=/i);
  });
});

describe('profile photo fallback and proxy URL', () => {
  it('falls back to initials when there is no photo', () => {
    expect(avatarUriOrFallback(false, 'file://photo.jpg')).toBeNull();
    expect(avatarUriOrFallback(undefined, 'file://photo.jpg')).toBeNull();
    expect(avatarUriOrFallback(true, null)).toBeNull();
    expect(avatarUriOrFallback(true, 'file://photo.jpg')).toBe('file://photo.jpg');
  });

  it('only accepts the authenticated app-proxied avatar path', () => {
    const path = profilePhotoProxyPath('11111111-2222-3333-4444-555555555555');
    expect(path).toBe('/users/id/11111111-2222-3333-4444-555555555555/avatar');
    expect(isSafeAvatarUrl(path)).toBe(true);
    expect(isSafeAvatarUrl(null)).toBe(true);
    expect(isSafeAvatarUrl('https://cdn.example/secret.jpg')).toBe(false);
    expect(isSafeAvatarUrl('/var/data/photos/me.jpg')).toBe(false);
    expect(isSafeAvatarUrl('/users/id/abc/avatar?token=secret')).toBe(false);
  });
});
