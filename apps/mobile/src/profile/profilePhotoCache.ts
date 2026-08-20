import * as FileSystem from 'expo-file-system/legacy';

import { API_URL } from '@/src/api/client';
import { ApiError, api, type User } from '@/src/api/hop';
import { isSafeAvatarUrl, profilePhotoProxyPath } from './profilePhoto';

const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeProfilePhotoCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearProfilePhotoCache(userId?: string) {
  if (userId) memory.delete(userId);
  else memory.clear();
  notify();
}

function cachePath(userId: string): string | null {
  const dir = FileSystem.cacheDirectory;
  if (!dir) return null;
  return `${dir}hop-avatar-${userId}.jpg`;
}

export async function fetchProfilePhotoFile(
  token: string,
  userId: string,
  hasAvatar?: boolean | null,
): Promise<string | null> {
  if (hasAvatar === false) {
    memory.set(userId, null);
    return null;
  }
  const cached = memory.get(userId);
  if (cached !== undefined) return cached;
  const dest = cachePath(userId);
  if (!dest) return null;
  const path = profilePhotoProxyPath(userId);
  if (!isSafeAvatarUrl(path)) return null;
  const result = await FileSystem.downloadAsync(`${API_URL}${path}`, dest, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (result.status === 404) {
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => undefined);
    memory.set(userId, null);
    return null;
  }
  if (result.status < 200 || result.status >= 300) {
    throw new ApiError(`Could not load photo (${result.status})`, result.status);
  }
  memory.set(userId, result.uri);
  return result.uri;
}

export async function uploadProfilePhotoFile(token: string, fileUri: string): Promise<User> {
  const response = await fetch(fileUri);
  const blob = await response.blob();
  const user = await api.putAvatar(token, blob);
  clearProfilePhotoCache(user.id);
  return user;
}
