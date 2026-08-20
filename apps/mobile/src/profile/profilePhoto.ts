export const AVATAR_MAX_BYTES = 240_000;
export const AVATAR_PIXEL_SIZE = 256;

/** PUT/DELETE the caller's photo. There is no GET on this path. */
export const PROFILE_PHOTO_MUTATE_PATH = '/users/me/avatar';

export class ProfilePhotoHttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ProfilePhotoHttpError';
  }
}

export function profilePhotoProxyPath(userId: string): string {
  return `/users/id/${encodeURIComponent(userId)}/avatar`;
}

/** App-proxied avatar paths only — never filesystem, S3, or signed secret URLs. */
export function isSafeAvatarUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  if (url.includes('://') || url.includes('..') || url.includes('\\')) return false;
  if (/(\/var\/|s3:|file:|secret|token=)/i.test(url)) return false;
  return /^\/users\/id\/[^/]+\/avatar$/.test(url);
}

export function avatarAuthHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return { Authorization: `Bearer ${token}`, ...extra };
}

export function avatarUriOrFallback(
  hasAvatar: boolean | null | undefined,
  uri: string | null | undefined,
): string | null {
  if (!hasAvatar) return null;
  return uri || null;
}

/** GET /avatar 404 is an empty photo, not a red error — including FastAPI's unmatched "Not Found". */
export function isMissingAvatarStatus(status: number): boolean {
  return status === 404;
}

export function isMissingAvatarError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'status' in err && isMissingAvatarStatus((err as { status: number }).status)) {
    return true;
  }
  const message = err instanceof Error ? err.message : '';
  return /\b404\b|not found|no profile photo/i.test(message);
}

export function shouldFetchAvatar(hasAvatar?: boolean | null): boolean {
  return hasAvatar !== false;
}

function detailFromJson(data: unknown, status: number): string {
  if (data && typeof data === 'object' && 'detail' in data && typeof (data as { detail: unknown }).detail === 'string') {
    return (data as { detail: string }).detail;
  }
  return `Could not load photo (${status})`;
}

/**
 * Authenticated GET `/users/id/{id}/avatar`.
 * 404 → `null` (no photo, or the live API has not deployed this route yet).
 * Other non-2xx → throw. Never JSON-parses a JPEG body.
 */
export async function fetchAvatarBytes(
  apiUrl: string,
  token: string,
  userId: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ArrayBuffer | null> {
  const path = profilePhotoProxyPath(userId);
  if (!isSafeAvatarUrl(path)) return null;
  let response: Response;
  try {
    response = await fetchImpl(`${apiUrl}${path}`, {
      method: 'GET',
      headers: avatarAuthHeaders(token, { Accept: 'image/jpeg' }),
    });
  } catch (err) {
    throw new ProfilePhotoHttpError(err instanceof Error ? err.message : 'Network error', 0);
  }
  if (isMissingAvatarStatus(response.status)) {
    return null;
  }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => ({}));
    throw new ProfilePhotoHttpError(detailFromJson(data, response.status), response.status);
  }
  return response.arrayBuffer();
}
