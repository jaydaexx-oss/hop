import { generateIdentityKeyPair, type IdentityKeyPair } from "./cryptoBox.js";
import {
  DEVICE_SECRET_KEY,
  IdentityError,
  discardPendingIdentity,
  newDeviceSecret,
  persistRestoredIdentity,
  peekStoredIdentity,
  peekWrapKey,
  readIdentityOwner,
  writeIdentityOwner,
  writeWrapKey,
  type SecretBackend,
} from "./identityLifecycle.js";
import { readySodium } from "./sodium.js";

/**
 * Returning-user recovery.
 *
 * Handle typing is never authentication. Private crypto_box keys never leave the
 * device (or an iCloud-backup-migratable Keychain wrap). The server stores the
 * public identity only and will not mint a replacement pair for an existing user_id.
 *
 * Paths:
 * - Passkey / WebAuthn (preferred going forward)
 * - iCloud Keychain / encrypted iOS backup of `hop.box.{userId}` (and optional wrap key)
 * - One-time password inside Recover my HOP for pre-passkey accounts, then enroll a passkey
 */

export type IdentityRecoveryMethod = "passkey" | "icloud_keychain" | "legacy_password_once";

export const IDENTITY_RECOVERY_EXTENSION_POINTS = [
  "passkey",
  "icloud_keychain",
  "legacy_password_once",
] as const;

export const HANDLE_TAKEN_RECOVER_COPY = "This handle already exists. Recover it?";
export const RECOVER_MY_HOP_LABEL = "Recover my HOP";
export const KEYS_MISSING_MESSAGE =
  "This device doesn’t have your HOP keys. Use a device that already has HOP, or restore from iCloud Keychain.";
export const HANDLE_IS_NOT_AUTH_MESSAGE =
  "Typing a handle is not enough to recover this identity. Prove you already own it.";
export const NO_RECOVERY_METHODS_MESSAGE =
  "This handle is taken. Sign in from a device that already has HOP, or restore this iPhone from iCloud. A handle alone cannot recover your identity.";

/** Onboarding a brand-new available handle does not require recovery. */
export function recoveryNotRequiredForOnboarding(): true {
  return true;
}

export function canClaimHandleWithoutRecovery(available: boolean): boolean {
  return available;
}

export function onboardingActionForHandle(available: boolean): "start_hopping" | "recover" {
  return available ? "start_hopping" : "recover";
}

export type RecoveryOptions = {
  username: string;
  available: boolean;
  passkey_enrolled: boolean;
  legacy_password: boolean;
};

export function recoveryMethodsFor(options: RecoveryOptions): IdentityRecoveryMethod[] {
  if (options.available) return [];
  const methods: IdentityRecoveryMethod[] = [];
  if (options.passkey_enrolled) methods.push("passkey");
  if (options.legacy_password) methods.push("legacy_password_once");
  methods.push("icloud_keychain");
  return methods;
}

export type RestoredIdentityStatus = "restored" | "keys_missing" | "mismatch";

export type RestoredIdentity =
  | { status: "restored"; pair: IdentityKeyPair; source: "keychain" | "wrap" }
  | { status: "keys_missing" }
  | { status: "mismatch"; localPublicKey: string; serverPublicKey: string };

function publishedKey(serverPublicKey: string | null | undefined): string {
  return (serverPublicKey ?? "").trim();
}

/**
 * Load the original identity for an existing user_id. Never generates a keypair.
 * If the server already published a public key, local keys must match it.
 */
export async function restoreOriginalIdentity(input: {
  userId: string;
  serverPublicKey: string | null | undefined;
  backend: SecretBackend;
  wrappedBlob?: string | null;
}): Promise<RestoredIdentity> {
  const serverPk = publishedKey(input.serverPublicKey);
  const local = await peekStoredIdentity(input.userId, input.backend);
  if (local) {
    if (serverPk && local.publicKey !== serverPk) {
      return { status: "mismatch", localPublicKey: local.publicKey, serverPublicKey: serverPk };
    }
    await writeIdentityOwner(input.userId, input.backend);
    return { status: "restored", pair: local, source: "keychain" };
  }

  if (input.wrappedBlob) {
    const wrap = await peekWrapKey(input.userId, input.backend);
    if (wrap) {
      try {
        const unwrapped = await unwrapIdentityMaterial(input.wrappedBlob, wrap);
        if (serverPk && unwrapped.publicKey !== serverPk) {
          return { status: "mismatch", localPublicKey: unwrapped.publicKey, serverPublicKey: serverPk };
        }
        const persisted = await persistRestoredIdentity(input.userId, unwrapped, input.backend);
        return { status: "restored", pair: persisted, source: "wrap" };
      } catch (err) {
        if (err instanceof IdentityError && err.code === "KEY_MISMATCH") throw err;
        /* wrap key present but blob will not open — still keys missing, never mint */
      }
    }
  }

  if (serverPk) return { status: "keys_missing" };
  /* No published key and no local secret: still refuse to mint during recovery. */
  return { status: "keys_missing" };
}

export type RecoveryAuth = {
  token: string;
  user: { id: string; username: string; identity_public_key?: string };
};

export type RecoveryTransport<A extends RecoveryAuth = RecoveryAuth> = {
  recoverPassword: (username: string, password: string) => Promise<A>;
  passkeyAuthenticate: (username: string) => Promise<A>;
  bindDevice: (token: string, deviceSecret: string) => Promise<A>;
  logout: (token: string) => Promise<void>;
  getIdentityWrap?: (token: string) => Promise<string | null>;
  putIdentityWrap?: (token: string, blob: string) => Promise<void>;
};

export type RecoveryProof =
  | { method: "legacy_password_once"; password: string }
  | { method: "passkey" };

/**
 * Authenticate a recovery credential, restore the original keypair, bind a new
 * device secret to the SAME user_id. Never registers a second account. Never mints keys.
 */
export async function recoverExistingIdentity<A extends RecoveryAuth>(
  backend: SecretBackend,
  api: RecoveryTransport<A>,
  username: string,
  proof: RecoveryProof,
): Promise<A> {
  const handle = username.trim().toLowerCase();
  if (!handle) {
    throw new IdentityError("IDENTITY_INACCESSIBLE", "Handle is required to look up recovery options.");
  }

  const auth =
    proof.method === "passkey"
      ? await api.passkeyAuthenticate(handle)
      : await api.recoverPassword(handle, proof.password);

  if (auth.user.username.trim().toLowerCase() !== handle) {
    await api.logout(auth.token).catch(() => undefined);
    throw new IdentityError(
      "KEY_MISMATCH",
      "Recovery returned a different handle. HOP will not adopt it.",
    );
  }

  const owner = await readIdentityOwner(backend);
  if (owner && owner !== auth.user.id) {
    await api.logout(auth.token).catch(() => undefined);
    throw new IdentityError(
      "IDENTITY_INACCESSIBLE",
      "This device already has a different HOP identity. Reset this device before recovering another account.",
    );
  }

  let wrappedBlob: string | null = null;
  if (api.getIdentityWrap) {
    try {
      wrappedBlob = await api.getIdentityWrap(auth.token);
    } catch {
      wrappedBlob = null;
    }
  }

  const restored = await restoreOriginalIdentity({
    userId: auth.user.id,
    serverPublicKey: auth.user.identity_public_key,
    backend,
    wrappedBlob,
  });

  if (restored.status === "mismatch") {
    await api.logout(auth.token).catch(() => undefined);
    throw new IdentityError(
      "KEY_MISMATCH",
      "Local identity public key does not match the key published on the server. HOP will not replace it.",
    );
  }
  if (restored.status === "keys_missing") {
    await api.logout(auth.token).catch(() => undefined);
    throw new IdentityError("KEYS_MISSING", KEYS_MISSING_MESSAGE);
  }

  await persistRestoredIdentity(auth.user.id, restored.pair, backend);
  await discardPendingIdentity(backend);

  /* Bind first, persist second: a failed bind must not clobber a device secret that still works. */
  const deviceSecret = newDeviceSecret();
  const bound = await api.bindDevice(auth.token, deviceSecret);
  if (bound.user.id !== auth.user.id) {
    await api.logout(bound.token).catch(() => undefined);
    throw new IdentityError(
      "KEY_MISMATCH",
      "Device bind returned a different user_id. HOP will not adopt it.",
    );
  }
  if (
    bound.user.identity_public_key &&
    restored.pair.publicKey !== bound.user.identity_public_key
  ) {
    await api.logout(bound.token).catch(() => undefined);
    throw new IdentityError(
      "KEY_MISMATCH",
      "Recovered keys do not match the published identity. HOP will not replace them.",
    );
  }
  await backend.write(DEVICE_SECRET_KEY, deviceSecret);
  await writeIdentityOwner(bound.user.id, backend);

  if (api.putIdentityWrap) {
    try {
      await upsertIdentityWrap(bound.user.id, backend, (blob) => api.putIdentityWrap!(bound.token, blob));
    } catch {
      /* wrap is best-effort; recovery already restored local keys */
    }
  }
  return bound;
}

type WrapBlob = {
  v: 1;
  alg: "crypto_box_xsalsa20poly1305";
  epk: string;
  nonce: string;
  ciphertext: string;
};

function isWrapBlob(value: unknown): value is WrapBlob {
  if (!value || typeof value !== "object") return false;
  const rec = value as Record<string, unknown>;
  return (
    rec.v === 1 &&
    rec.alg === "crypto_box_xsalsa20poly1305" &&
    typeof rec.epk === "string" &&
    typeof rec.nonce === "string" &&
    typeof rec.ciphertext === "string"
  );
}

/** Encrypt the identity keypair to a Keychain wrap key. The blob is safe to store on the server. */
export async function wrapIdentityMaterial(pair: IdentityKeyPair, wrap: IdentityKeyPair): Promise<string> {
  const s = await readySodium();
  const variant = s.base64_variants.ORIGINAL;
  const ephemeral = s.crypto_box_keypair();
  const nonce = s.randombytes_buf(s.crypto_box_NONCEBYTES);
  const plaintext = s.from_string(JSON.stringify(pair));
  const ciphertext = s.crypto_box_easy(
    plaintext,
    nonce,
    s.from_base64(wrap.publicKey, variant),
    ephemeral.privateKey,
  );
  const blob: WrapBlob = {
    v: 1,
    alg: "crypto_box_xsalsa20poly1305",
    epk: s.to_base64(ephemeral.publicKey, variant),
    nonce: s.to_base64(nonce, variant),
    ciphertext: s.to_base64(ciphertext, variant),
  };
  const json = JSON.stringify(blob);
  if (json.includes(pair.secretKey) || json.includes(wrap.secretKey)) {
    throw new Error("Private identity key must never enter a wrap blob in plaintext");
  }
  return json;
}

export async function unwrapIdentityMaterial(blob: string, wrap: IdentityKeyPair): Promise<IdentityKeyPair> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(blob);
  } catch {
    throw new IdentityError("KEYS_MISSING", KEYS_MISSING_MESSAGE);
  }
  if (!isWrapBlob(parsed)) {
    throw new IdentityError("KEYS_MISSING", KEYS_MISSING_MESSAGE);
  }
  const s = await readySodium();
  const variant = s.base64_variants.ORIGINAL;
  let opened: Uint8Array;
  try {
    opened = s.crypto_box_open_easy(
      s.from_base64(parsed.ciphertext, variant),
      s.from_base64(parsed.nonce, variant),
      s.from_base64(parsed.epk, variant),
      s.from_base64(wrap.secretKey, variant),
    );
  } catch {
    throw new IdentityError("KEYS_MISSING", KEYS_MISSING_MESSAGE);
  }
  const pair = JSON.parse(s.to_string(opened)) as IdentityKeyPair;
  if (!pair?.publicKey || !pair?.secretKey) {
    throw new IdentityError("KEYS_MISSING", KEYS_MISSING_MESSAGE);
  }
  return pair;
}

export async function upsertIdentityWrap(
  userId: string,
  backend: SecretBackend,
  putWrap: (blob: string) => Promise<void>,
  generate: () => Promise<IdentityKeyPair> = generateIdentityKeyPair,
): Promise<void> {
  const pair = await peekStoredIdentity(userId, backend);
  if (!pair) return;
  let wrap = await peekWrapKey(userId, backend);
  if (!wrap) {
    wrap = await generate();
    await writeWrapKey(userId, wrap, backend);
  }
  await putWrap(await wrapIdentityMaterial(pair, wrap));
}
