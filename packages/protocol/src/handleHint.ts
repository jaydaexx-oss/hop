import { HOP_USERNAME_RE, normalizeHopUsername } from "./hopQr.js";

/**
 * Last-used HOP handle/display name. Not a secret — persist in AsyncStorage /
 * non-SecureStore only. Never store keys, tokens, device secrets, or user_id here.
 */
export const HANDLE_HINT_KEY = "hop.handle.hint";
export const USE_DIFFERENT_HANDLE_LABEL = "Use a different handle";

/** Non-secret persistence. Not Keychain / SecureStore. */
export type NonSecretStore = {
  read(key: string): Promise<string | null>;
  write(key: string, value: string | null): Promise<void>;
};

function looksLikeStructuredBlob(raw: string): boolean {
  const trimmed = raw.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.includes(":");
}

/** Accept only a bare HOP handle. Reject JSON, user_id, tokens, and keys. */
export function sanitizeHandleHint(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || looksLikeStructuredBlob(trimmed)) return null;
  const handle = normalizeHopUsername(trimmed.replace(/^@+/, ""));
  if (!HOP_USERNAME_RE.test(handle)) return null;
  return handle;
}

export function formatPreviousHopLabel(handle: string): string {
  const sanitized = sanitizeHandleHint(handle);
  return sanitized ? `Previous HOP: @${sanitized}` : "";
}

export function handleFromCachedUser(user: { username?: unknown } | null | undefined): string | null {
  if (!user || typeof user.username !== "string") return null;
  return sanitizeHandleHint(user.username);
}

export function onboardingModeForHandleHint(
  hint: string | null | undefined,
): "returning_handle" | "new_user" {
  return sanitizeHandleHint(hint) ? "returning_handle" : "new_user";
}

/** A remembered handle is a UX hint only. It never authenticates. */
export function handleHintIsAuthentication(): false {
  return false;
}

/** Prefill + Recover button only. Never start recovery from a stored hint. */
export function shouldAutoStartRecoveryFromHandleHint(): false {
  return false;
}

export async function writeHandleHint(
  store: NonSecretStore,
  handle: string | null | undefined,
): Promise<void> {
  await store.write(HANDLE_HINT_KEY, sanitizeHandleHint(handle ?? null));
}

export async function readHandleHint(store: NonSecretStore): Promise<string | null> {
  return sanitizeHandleHint(await store.read(HANDLE_HINT_KEY));
}

export async function clearHandleHint(store: NonSecretStore): Promise<void> {
  await store.write(HANDLE_HINT_KEY, null);
}
