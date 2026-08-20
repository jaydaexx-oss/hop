export const AVATAR_MAX_BYTES = 240_000;
export const AVATAR_PIXEL_SIZE = 256;

export function profilePhotoProxyPath(userId: string): string {
  return `/users/id/${userId}/avatar`;
}

/** App-proxied avatar paths only — never filesystem, S3, or signed secret URLs. */
export function isSafeAvatarUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  if (url.includes('://') || url.includes('..') || url.includes('\\')) return false;
  if (/(\/var\/|s3:|file:|secret|token=)/i.test(url)) return false;
  return /^\/users\/id\/[^/]+\/avatar$/.test(url);
}

export function avatarUriOrFallback(
  hasAvatar: boolean | null | undefined,
  uri: string | null | undefined,
): string | null {
  if (!hasAvatar) return null;
  return uri || null;
}
