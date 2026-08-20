import * as FileSystem from 'expo-file-system/legacy';

import { API_URL } from '@/src/api/client';
import { api, type User } from '@/src/api/hop';
import { fetchAvatarBytes, shouldFetchAvatar } from './profilePhoto';

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

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function persistJpeg(userId: string, buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const base64 = bytesToBase64(bytes);
  const dest = cachePath(userId);
  if (!dest) return `data:image/jpeg;base64,${base64}`;
  await FileSystem.writeAsStringAsync(dest, base64, { encoding: FileSystem.EncodingType.Base64 });
  return dest;
}

export async function fetchProfilePhotoFile(
  token: string,
  userId: string,
  hasAvatar?: boolean | null,
): Promise<string | null> {
  if (!shouldFetchAvatar(hasAvatar)) {
    memory.set(userId, null);
    return null;
  }
  const cached = memory.get(userId);
  if (cached) return cached;
  if (cached === null && hasAvatar !== true) return null;

  const bytes = await fetchAvatarBytes(API_URL, token, userId);
  if (!bytes) {
    const dest = cachePath(userId);
    if (dest) await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => undefined);
    memory.set(userId, null);
    return null;
  }
  const uri = await persistJpeg(userId, bytes);
  memory.set(userId, uri);
  return uri;
}

export async function uploadProfilePhotoFile(token: string, fileUri: string): Promise<User> {
  const base64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const user = await api.putAvatar(token, binary);
  memory.set(user.id, fileUri);
  notify();
  return user;
}
