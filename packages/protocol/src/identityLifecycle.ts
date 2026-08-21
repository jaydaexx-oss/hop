import { generateIdentityKeyPair, isWellFormedBoxPublicKey, type IdentityKeyPair } from "./cryptoBox.js";
import { createCsprngUuid } from "./ids.js";

export const IDENTITY_SECRET_PREFIX = "hop.box.";
export const IDENTITY_MARKER_PREFIX = "hop.box.marker.";
/** iCloud-backup-migratable wrapping key for an opaque server-side identity blob. Not the identity secret. */
export const IDENTITY_WRAP_PREFIX = "hop.wrap.";
/** Durable owner of the local crypto identity. Survives expired session tokens. */
export const IDENTITY_OWNER_KEY = "hop.identity.userId";
/** Companion device credential in SecureStore. Not derived from the handle. */
export const DEVICE_SECRET_KEY = "hop.device.secret";
/**
 * Opaque per-install UUID. Survives Reset HOP so the API can rate-limit
 * account recreation without a permanent hardware fingerprint.
 */
export const INSTALL_ID_KEY = "hop.install.id";
/** Hashed install id header on POST /auth/register-device. Never the raw UUID. */
export const INSTALL_HEADER_NAME = "X-Hop-Install";
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
  | "IDENTITY_RESET_REQUIRED"
  | "KEYS_MISSING";

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
    "This account already has a published identity public key. HOP will not replace it. Recover the original private key from a device that still has HOP, or from an encrypted backup restore. Unauthenticated key replacement is not allowed.",
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

function wrapStoreKey(userId: string): string {
  return `${IDENTITY_WRAP_PREFIX}${userId}`;
}

export async function readIdentityOwner(backend: SecretBackend): Promise<string | null> {
  const value = await backend.read(IDENTITY_OWNER_KEY);
  return value && value.trim() ? value.trim() : null;
}

export async function writeIdentityOwner(userId: string, backend: SecretBackend): Promise<void> {
  if (!userId.trim()) return;
  await backend.write(IDENTITY_OWNER_KEY, userId.trim());
}

/**
 * Explicit local wipe of this device’s HOP identity only.
 * Does not delete the server user, chats, events, contacts, or blocks.
 * Does not clear hop.install.id (anti-abuse signal, not identity).
 * After this, first-launch onboarding may mint a new keypair.
 */
export async function clearLocalDeviceIdentity(backend: SecretBackend): Promise<void> {
  const owner = await readIdentityOwner(backend);
  if (owner) {
    await backend.write(secretStoreKey(owner), null);
    await backend.write(markerStoreKey(owner), null);
    await backend.write(wrapStoreKey(owner), null);
  }
  await backend.write(secretStoreKey(PENDING_IDENTITY_SLOT), null);
  await backend.write(markerStoreKey(PENDING_IDENTITY_SLOT), null);
  await backend.write(wrapStoreKey(PENDING_IDENTITY_SLOT), null);
  await backend.write(IDENTITY_OWNER_KEY, null);
  await backend.write(DEVICE_SECRET_KEY, null);
}

type ExpoDigestStringAsync = (
  algorithm: string,
  data: string,
  options?: { encoding?: string },
) => Promise<string>;

type HopCrypto = Crypto & {
  digestStringAsync?: ExpoDigestStringAsync;
};

function bytesToSha256Hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeSha256Hex(hex: string): string {
  const normalized = hex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("SHA-256 hex digest is malformed");
  }
  return normalized;
}

function expoDigestStringAsync(): ExpoDigestStringAsync | undefined {
  const cryptoObj = globalThis.crypto as HopCrypto | undefined;
  if (typeof cryptoObj?.digestStringAsync === "function") {
    return cryptoObj.digestStringAsync.bind(cryptoObj);
  }
  return undefined;
}

/**
 * SHA-256 hex of a UTF-8 string. Hermes has `crypto` (getRandomValues) but no
 * `crypto.subtle`, so `crypto.subtle.digest` throws. Prefer expo-crypto
 * `digestStringAsync` when the mobile polyfill installed it; otherwise Web Crypto.
 * Never a non-cryptographic hash.
 */
export async function sha256Hex(value: string): Promise<string> {
  const expoDigest = expoDigestStringAsync();
  if (expoDigest) {
    const hex = await expoDigest("SHA-256", value, { encoding: "hex" });
    return normalizeSha256Hex(hex);
  }
  const subtle = globalThis.crypto?.subtle;
  if (typeof subtle?.digest === "function") {
    const bytes = new TextEncoder().encode(value);
    const digest = await subtle.digest("SHA-256", bytes);
    return normalizeSha256Hex(bytesToSha256Hex(new Uint8Array(digest)));
  }
  throw new Error("SHA-256 is unavailable on this runtime");
}

export async function loadOrCreateInstallId(backend: SecretBackend): Promise<string> {
  const existing = await backend.read(INSTALL_ID_KEY);
  if (existing && existing.trim()) return existing.trim();
  let created: string;
  try {
    created = createCsprngUuid();
  } catch {
    throw new IdentityError("SECRET_STORE_UNAVAILABLE", "CSPRNG UUID is unavailable on this runtime");
  }
  await backend.write(INSTALL_ID_KEY, created);
  return created;
}

/** SHA-256 hex of the opaque install UUID. Sent as X-Hop-Install; never the raw UUID. */
export async function hashedInstallHeaderValue(backend: SecretBackend): Promise<string> {
  return sha256Hex(await loadOrCreateInstallId(backend));
}

/** Drop an unpublished first-launch pair. Never writes hop.box.{userId}. */
export async function discardPendingIdentity(backend: SecretBackend): Promise<void> {
  await backend.write(secretStoreKey(PENDING_IDENTITY_SLOT), null);
  await backend.write(markerStoreKey(PENDING_IDENTITY_SLOT), null);
}

export async function peekWrapKey(userId: string, backend: SecretBackend): Promise<IdentityKeyPair | null> {
  const stored = await backend.read(wrapStoreKey(userId));
  if (!stored) return null;
  return parsePair(stored);
}

export async function writeWrapKey(userId: string, pair: IdentityKeyPair, backend: SecretBackend): Promise<void> {
  await backend.write(wrapStoreKey(userId), JSON.stringify(pair));
}

/**
 * Restore a previously known identity into hop.box.{userId}.
 * Never generates a replacement pair. Refuses to overwrite a different local pair.
 */
export async function persistRestoredIdentity(
  userId: string,
  pair: IdentityKeyPair,
  backend: SecretBackend,
): Promise<IdentityKeyPair> {
  if (!userId.trim() || !pair.publicKey || !pair.secretKey) {
    throw new IdentityError("KEY_MISMATCH", "Cannot persist an incomplete identity.");
  }
  const existing = await peekStoredIdentity(userId, backend);
  if (existing) {
    if (existing.publicKey !== pair.publicKey) {
      throw new IdentityError(
        "KEY_MISMATCH",
        "This install already has identity keys for this user_id. HOP will not replace them.",
      );
    }
    await writeIdentityOwner(userId, backend);
    if (!(await backend.read(markerStoreKey(userId)))) {
      await backend.write(markerStoreKey(userId), existing.publicKey);
    }
    return existing;
  }
  await backend.write(secretStoreKey(userId), JSON.stringify(pair));
  await backend.write(markerStoreKey(userId), pair.publicKey);
  await writeIdentityOwner(userId, backend);
  return pair;
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
