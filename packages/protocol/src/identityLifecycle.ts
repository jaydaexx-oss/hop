import { generateIdentityKeyPair, type IdentityKeyPair } from "./cryptoBox.js";

export const IDENTITY_SECRET_PREFIX = "hop.box.";
export const IDENTITY_MARKER_PREFIX = "hop.box.marker.";

export type IdentityErrorCode =
  | "SECRET_STORE_UNAVAILABLE"
  | "IDENTITY_INACCESSIBLE"
  | "KEY_MISMATCH"
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
