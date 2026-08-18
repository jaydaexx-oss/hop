import sodium from "libsodium-wrappers";

/**
 * Protocol-facing libsodium surface. Callers must not import libsodium-wrappers
 * directly. Node/web use the ESM wasm build; native Hermes uses the official
 * CJS wasm2js backup of the same library (Metro alias). Same NaCl crypto_box
 * wire format either way.
 */
export type HopSodium = typeof sodium;

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

const REQUIRED_SIZES = ["crypto_box_NONCEBYTES", "crypto_auth_KEYBYTES"] as const;

function assertHopSodium(s: HopSodium): HopSodium {
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
  const variants = api.base64_variants as { ORIGINAL?: unknown } | undefined;
  if (variants?.ORIGINAL == null) {
    throw new Error("libsodium backend missing base64_variants.ORIGINAL");
  }
  return s;
}

let readyPromise: Promise<HopSodium> | null = null;

export async function readySodium(): Promise<HopSodium> {
  if (!readyPromise) {
    readyPromise = Promise.resolve(sodium.ready).then(() => assertHopSodium(sodium));
  }
  return readyPromise;
}
