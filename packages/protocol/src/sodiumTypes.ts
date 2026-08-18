export const ORIGINAL_BASE64 = 1;

export interface HopSodium {
  crypto_box_NONCEBYTES: number;
  crypto_box_PUBLICKEYBYTES: number;
  crypto_box_SECRETKEYBYTES: number;
  crypto_box_MACBYTES: number;
  crypto_box_BEFORENMBYTES: number;
  crypto_auth_KEYBYTES: number;
  crypto_auth_BYTES: number;
  base64_variants: { ORIGINAL: typeof ORIGINAL_BASE64 | number };
  crypto_box_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  crypto_box_easy(message: Uint8Array, nonce: Uint8Array, pk: Uint8Array, sk: Uint8Array): Uint8Array;
  crypto_box_open_easy(ciphertext: Uint8Array, nonce: Uint8Array, pk: Uint8Array, sk: Uint8Array): Uint8Array;
  crypto_box_beforenm(pk: Uint8Array, sk: Uint8Array): Uint8Array;
  crypto_auth(message: Uint8Array, key: Uint8Array): Uint8Array;
  crypto_auth_verify(mac: Uint8Array, message: Uint8Array, key: Uint8Array): boolean;
  crypto_generichash(outlen: number, message: Uint8Array, key?: Uint8Array | null): Uint8Array;
  randombytes_buf(length: number): Uint8Array;
  from_base64(input: string, variant?: unknown): Uint8Array;
  to_base64(bytes: Uint8Array, variant?: unknown): string;
  from_string(input: string): Uint8Array;
  to_string(bytes: Uint8Array): string;
  to_hex(bytes: Uint8Array): string;
}

const REQUIRED_FNS = [
  "crypto_box_keypair",
  "crypto_box_easy",
  "crypto_box_open_easy",
  "crypto_box_beforenm",
  "crypto_auth",
  "crypto_auth_verify",
  "crypto_generichash",
  "randombytes_buf",
  "from_base64",
  "to_base64",
  "from_string",
  "to_string",
  "to_hex",
] as const;

const REQUIRED_SIZES = [
  "crypto_box_NONCEBYTES",
  "crypto_box_PUBLICKEYBYTES",
  "crypto_box_SECRETKEYBYTES",
  "crypto_box_MACBYTES",
  "crypto_box_BEFORENMBYTES",
  "crypto_auth_KEYBYTES",
  "crypto_auth_BYTES",
] as const;

export function assertHopSodium(s: HopSodium): HopSodium {
  const api = s as unknown as Record<string, unknown>;
  for (const name of REQUIRED_FNS) {
    if (typeof api[name] !== "function") {
      throw new Error(`libsodium backend missing required primitive ${name}`);
    }
  }
  for (const name of REQUIRED_SIZES) {
    if (typeof api[name] !== "number" || (api[name] as number) <= 0) {
      throw new Error(`libsodium backend missing required constant ${name}`);
    }
  }
  if ((api.crypto_box_NONCEBYTES as number) !== 24) {
    throw new Error("libsodium backend crypto_box_NONCEBYTES must be 24");
  }
  if ((api.crypto_box_PUBLICKEYBYTES as number) !== 32 || (api.crypto_box_SECRETKEYBYTES as number) !== 32) {
    throw new Error("libsodium backend key sizes must be 32/32");
  }
  if ((api.crypto_box_MACBYTES as number) !== 16) {
    throw new Error("libsodium backend crypto_box_MACBYTES must be 16");
  }
  if ((api.crypto_box_BEFORENMBYTES as number) !== 32 || (api.crypto_auth_KEYBYTES as number) !== 32) {
    throw new Error("libsodium backend beforenm/auth key sizes must be 32");
  }
  if ((api.crypto_auth_BYTES as number) !== 32) {
    throw new Error("libsodium backend crypto_auth_BYTES must be 32");
  }
  const variants = api.base64_variants as { ORIGINAL?: unknown } | undefined;
  if (variants?.ORIGINAL == null) {
    throw new Error("libsodium backend missing base64_variants.ORIGINAL");
  }
  return s;
}

export function isNativeExpoOs(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const os = env?.EXPO_OS;
  return os === "ios" || os === "android";
}

export const NATIVE_SODIUM_MISSING =
  "Native libsodium backend is required on iOS/Android. Rebuild the EAS dev client after adding hop-sodium; Fast Refresh cannot load native C.";
