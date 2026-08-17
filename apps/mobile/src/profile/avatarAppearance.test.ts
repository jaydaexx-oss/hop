import { describe, expect, it } from 'vitest';
import { encodeHopQrPayload, hopQrUri } from '@hop/protocol';

import { MemoryKvStore } from '@/src/nearby/kvStore';
import {
  defaultLocalAvatarColor,
  loadLocalAvatarColor,
  saveLocalAvatarColor,
} from '@/src/profile/avatarAppearance';

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
