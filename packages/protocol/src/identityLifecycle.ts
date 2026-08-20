import { generateIdentityKeyPair, isWellFormedBoxPublicKey, type IdentityKeyPair } from "./cryptoBox.js";

export const IDENTITY_SECRET_PREFIX = "hop.box.";
export const IDENTITY_MARKER_PREFIX = "hop.box.marker.";
/** Durable owner of the local crypto identity. Survives expired session tokens. */
export const IDENTITY_OWNER_KEY = "hop.identity.userId";
/** Companion device credential in SecureStore. Not derived from the handle. */
export const DEVICE_SECRET_KEY = "hop.device.secret";
/**
 * Temporary SecureStore slot used only before the server assigns `user.id`.
 * After bind, the same keypair is stored under hop.box.{userId} — never a second pair.
 */
export const PENDING_IDENTITY_SLOT = "pending";

export type IdentityErrorCode =
  | "SECRET_STORE_UNAVAILABLE"
  | "IDENTITY_INACCESSIBLE"
  | "KEY_MISMATCH"
  | "SERVER_KEY_LOCKED"
  | "IDENTITY_RESET_REQUIRED";

export class IdentityError extends Error {
  readonly code: IdentityErrorCode;

  constructor(code: IdentityErrorCode, message: string) {
    super(message);
    this.name = "IdentityError";
    this.code = code;
  }
}

export interface SecretBackend {
  read(key: string): Promise<string | null>;
  write(key: string, value: string | null): Promise<void>;
}

/** PUT /users/me/identity body. Never include secretKey. */
export function identityPublishBody(publicKey: string): { public_key: string } {
  return { public_key: publicKey };
}

export function assertWellFormedPublishKey(publicKey: string): void {
  if (!isWellFormedBoxPublicKey(publicKey)) {
    throw new IdentityError("KEY_MISMATCH", "Malformed identity public key");
  }
}

export type IdentityPublishAction = "publish" | "skip" | "mismatch";

/** First publish when the server has no key. Matching key is idempotent. Different key must not PUT. */
export function decideIdentityPublish(
  localPublicKey: string,
  serverPublicKey: string | null | undefined,
): IdentityPublishAction {
  const published = (serverPublicKey ?? "").trim();
  if (!published) return "publish";
  if (published === localPublicKey) return "skip";
  return "mismatch";
}

export function isHttpConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const record = err as { status?: unknown; statusCode?: unknown };
  return record.status === 409 || record.statusCode === 409;
}

export function serverKeyLockedError(): IdentityError {
  return new IdentityError(
    "SERVER_KEY_LOCKED",
    "This account already has a published identity public key. HOP will not replace it. Recovery is a new account. A future rotation API must prove possession of the old secret; unauthenticated key replacement is not allowed.",
  );
}

/**
 * Publish the local public key only when the server has none.
 * Never PUT on KEY_MISMATCH. Map HTTP 409 to SERVER_KEY_LOCKED (do not retry).
 */
export async function publishIdentityIfAllowed(input: {
  localPublicKey: string;
  serverPublicKey: string | null | undefined;
  put: (body: { public_key: string }) => Promise<void>;
}): Promise<"ok" | "skipped"> {
  if (!isWellFormedBoxPublicKey(input.localPublicKey)) {
    throw new IdentityError("KEY_MISMATCH", "Malformed identity public key");
  }
  const published = (input.serverPublicKey ?? "").trim();
  if (published && !isWellFormedBoxPublicKey(published)) {
    throw new IdentityError("KEY_MISMATCH", "Server-published identity public key is malformed");
  }
  const action = decideIdentityPublish(input.localPublicKey, input.serverPublicKey);
  if (action === "mismatch") {
    assertPublishedIdentityMatches(input.localPublicKey, input.serverPublicKey);
  }
  if (action === "skip") return "skipped";
  const body = identityPublishBody(input.localPublicKey);
  assertIdentityPublishHasNoSecret(body as Record<string, unknown>, "");
  try {
    await input.put(body);
  } catch (err) {
    if (isHttpConflict(err)) throw serverKeyLockedError();
    throw err;
  }
  return "ok";
}

export function assertIdentityPublishHasNoSecret(
  body: Record<string, unknown>,
  secretKey: string,
): void {
  const json = JSON.stringify(body);
  if ("secret_key" in body || "secretKey" in body || "secret" in body) {
    throw new Error("Private identity key must never enter an API payload");
  }
  if (secretKey && json.includes(secretKey)) {
    throw new Error("Private identity key must never enter an API payload");
  }
}

/**
 * Compare the local public key to the server-published identity.
 * Empty server key means first publish is allowed. A different key is KEY_MISMATCH —
 * do not PUT a replacement over a 409.
 */
export function assertPublishedIdentityMatches(
  localPublicKey: string,
  serverPublicKey: string | null | undefined,
): void {
  const published = (serverPublicKey ?? "").trim();
  if (!published) return;
  if (published !== localPublicKey) {
    throw new IdentityError(
      "KEY_MISMATCH",
      "Local identity public key does not match the key published on the server. HOP will not silently replace it. Re-verify with your contacts after an explicit recovery.",
    );
  }
}

function parsePair(raw: string): IdentityKeyPair | null {
  try {
    const parsed = JSON.parse(raw) as IdentityKeyPair;
    if (parsed?.publicKey && parsed?.secretKey) return parsed;
  } catch {
    /* corrupt */
  }
  return null;
}

function secretStoreKey(userId: string): string {
  return `${IDENTITY_SECRET_PREFIX}${userId}`;
}

function markerStoreKey(userId: string): string {
  return `${IDENTITY_MARKER_PREFIX}${userId}`;
}

export async function readIdentityOwner(backend: SecretBackend): Promise<string | null> {
  const value = await backend.read(IDENTITY_OWNER_KEY);
  return value && value.trim() ? value.trim() : null;
}

export async function writeIdentityOwner(userId: string, backend: SecretBackend): Promise<void> {
  if (!userId.trim()) return;
  await backend.write(IDENTITY_OWNER_KEY, userId.trim());
}

export async function peekStoredIdentity(
  userId: string,
  backend: SecretBackend,
): Promise<IdentityKeyPair | null> {
  const stored = await backend.read(secretStoreKey(userId));
  if (!stored) return null;
  return parsePair(stored);
}

/**
 * True when this install already has a HOP identity (including an inaccessible marker).
 * Callers must not mint a new keypair or a new server user_id in that case.
 */
export async function hasExistingLocalIdentity(backend: SecretBackend): Promise<boolean> {
  const owner = await readIdentityOwner(backend);
  if (owner) {
    if (await peekStoredIdentity(owner, backend)) return true;
    if (await backend.read(markerStoreKey(owner))) return true;
  }
  if (await peekStoredIdentity(PENDING_IDENTITY_SLOT, backend)) return true;
  if (await backend.read(markerStoreKey(PENDING_IDENTITY_SLOT))) return true;
  return false;
}

export function mustNotCreateNewAccount(hasOwnerUserId: boolean): boolean {
  return hasOwnerUserId;
}

/** Valid session or a bound local identity: skip the first-run handle screen. */
export async function shouldSkipOnboarding(
  backend: SecretBackend,
  hasSessionUser: boolean,
): Promise<boolean> {
  if (hasSessionUser) return true;
  return (await readIdentityOwner(backend)) !== null;
}

export function newDeviceSecret(): string {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = (Date.now() + i * 17) & 0xff;
  }
  const binary = String.fromCharCode(...bytes);
  return globalThis.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function peekDeviceSecret(backend: SecretBackend): Promise<string | null> {
  const value = await backend.read(DEVICE_SECRET_KEY);
  return value && value.trim().length >= 32 ? value.trim() : null;
}

export async function loadOrCreateDeviceSecret(backend: SecretBackend): Promise<string> {
  const existing = await peekDeviceSecret(backend);
  if (existing) return existing;
  const created = newDeviceSecret();
  await backend.write(DEVICE_SECRET_KEY, created);
  return created;
}

/**
 * First-launch keypair only. If an owner identity already exists, return it —
 * never generate a replacement under the pending slot.
 */
export async function loadOrCreatePendingIdentity(
  backend: SecretBackend,
  generate: () => Promise<IdentityKeyPair> = generateIdentityKeyPair,
): Promise<IdentityKeyPair> {
  const owner = await readIdentityOwner(backend);
  if (owner) {
    return loadOrCreateIdentity(owner, backend, async () => {
      throw new IdentityError(
        "IDENTITY_INACCESSIBLE",
        "A local HOP identity already exists for this install. HOP will not generate a replacement key.",
      );
    });
  }
  return loadOrCreateIdentity(PENDING_IDENTITY_SLOT, backend, generate);
}

/**
 * Move the pending pair under the server-assigned user_id.
 * If hop.box.{userId} already exists, keep it and refuse to overwrite.
 */
export async function bindPendingIdentityToUser(
  userId: string,
  backend: SecretBackend,
): Promise<IdentityKeyPair> {
  const existing = await peekStoredIdentity(userId, backend);
  if (existing) {
    const pending = await peekStoredIdentity(PENDING_IDENTITY_SLOT, backend);
    if (pending && pending.publicKey !== existing.publicKey) {
      throw new IdentityError(
        "KEY_MISMATCH",
        "This install already has identity keys for this user_id. HOP will not replace them with a pending pair.",
      );
    }
    await writeIdentityOwner(userId, backend);
    return existing;
  }
  const pending = await peekStoredIdentity(PENDING_IDENTITY_SLOT, backend);
  if (!pending) {
    throw new IdentityError(
      "IDENTITY_INACCESSIBLE",
      "No pending identity to bind. HOP will not generate a replacement key.",
    );
  }
  await backend.write(secretStoreKey(userId), JSON.stringify(pending));
  await backend.write(markerStoreKey(userId), pending.publicKey);
  await writeIdentityOwner(userId, backend);
  await backend.write(secretStoreKey(PENDING_IDENTITY_SLOT), null);
  await backend.write(markerStoreKey(PENDING_IDENTITY_SLOT), null);
  return pending;
}

/**
 * Load the device identity or create one on first launch only.
 * If a durable marker says an identity existed but the secret is missing, fail closed.
 * Never silently generate a replacement pair.
 */
export async function loadOrCreateIdentity(
  userId: string,
  backend: SecretBackend,
  generate: () => Promise<IdentityKeyPair> = generateIdentityKeyPair,
): Promise<IdentityKeyPair> {
  const secretKey = `${IDENTITY_SECRET_PREFIX}${userId}`;
  const markerKey = `${IDENTITY_MARKER_PREFIX}${userId}`;
  const stored = await backend.read(secretKey);
  const marker = await backend.read(markerKey);

  if (stored) {
    const pair = parsePair(stored);
    if (pair) {
      if (!marker) await backend.write(markerKey, pair.publicKey);
      return pair;
    }
  }

  if (marker || stored) {
    throw new IdentityError(
      "IDENTITY_INACCESSIBLE",
      "An identity exists on this device but the secret key is inaccessible. HOP will not generate a replacement key. Use explicit local recovery, then re-verify with your contacts.",
    );
  }

  const pair = await generate();
  await backend.write(secretKey, JSON.stringify(pair));
  await backend.write(markerKey, pair.publicKey);
  return pair;
}

/**
 * Explicit user-initiated local rotation only. Does not upload the secret.
 * Publishing the new public key will 409 until the server identity is reset.
 */
export async function replaceIdentityExplicit(
  userId: string,
  backend: SecretBackend,
  generate: () => Promise<IdentityKeyPair> = generateIdentityKeyPair,
): Promise<IdentityKeyPair> {
  const secretKey = `${IDENTITY_SECRET_PREFIX}${userId}`;
  const markerKey = `${IDENTITY_MARKER_PREFIX}${userId}`;
  const pair = await generate();
  await backend.write(secretKey, JSON.stringify(pair));
  await backend.write(markerKey, pair.publicKey);
  return pair;
}
