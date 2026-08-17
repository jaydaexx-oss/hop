import { useCallback, useEffect, useState } from 'react';

import { createPersistentKv } from '@/src/nearby/kvStore';

import { defaultLocalAvatarColor, loadLocalAvatarColor, saveLocalAvatarColor } from './avatarAppearance';

const kv = createPersistentKv();

export function useLocalAvatarColor(userId?: string | null) {
  const [color, setColor] = useState(() => defaultLocalAvatarColor(userId || 'hop'));

  useEffect(() => {
    if (!userId) return;
    loadLocalAvatarColor(kv, userId).then(setColor).catch(() => undefined);
  }, [userId]);

  const select = useCallback(
    async (next: string) => {
      if (!userId) return;
      await saveLocalAvatarColor(kv, userId, next);
      setColor(next);
    },
    [userId],
  );

  return { color, select };
}
