import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/src/auth/AuthProvider';
import {
  fetchProfilePhotoFile,
  subscribeProfilePhotoCache,
} from './profilePhotoCache';

export function useProfilePhoto(userId?: string | null, hasAvatar?: boolean | null) {
  const { token } = useAuth();
  const [uri, setUri] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'missing' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => subscribeProfilePhotoCache(() => setTick((n) => n + 1)), []);

  const load = useCallback(async () => {
    if (!token || !userId) {
      setUri(null);
      setStatus('missing');
      return;
    }
    if (hasAvatar === false) {
      setUri(null);
      setStatus('missing');
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const next = await fetchProfilePhotoFile(token, userId, hasAvatar);
      setUri(next);
      setStatus(next ? 'ready' : 'missing');
    } catch (err) {
      setUri(null);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Could not load photo');
    }
  }, [hasAvatar, tick, token, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { uri, status, error, retry: load };
}
