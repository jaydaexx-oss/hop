import { readySodium } from "./cryptoBox.js";

/**
 * Display helper for a persisted identity public key.
 * This is a TOFU fingerprint, not certificate attestation and not a Signal safety number.
 */
export function formatPersistedFingerprint(publicKey: string): string {
  const compact = publicKey.replace(/[^A-Za-z0-9+/]/g, "");
  if (compact.length < 8) return "fp:unavailable";
  const groups = compact.slice(0, 24).match(/.{1,4}/g) ?? [compact.slice(0, 8)];
  return groups.join(" ");
}

/** Hashed fingerprint for a later QR / safety-number UI. Not an attestation. */
export async function identityFingerprint(publicKey: string): Promise<string> {
  const s = await readySodium();
  const variant = s.base64_variants.ORIGINAL;
  let raw: Uint8Array;
  try {
    raw = s.from_base64(publicKey, variant);
  } catch {
    raw = s.from_string(publicKey);
  }
  const digest = s.crypto_generichash(32, raw, s.from_string("hop-identity-fp-v1"));
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const n = ((digest[i * 2] ?? 0) << 8) | (digest[i * 2 + 1] ?? 0);
    groups.push(String(n % 100_000).padStart(5, "0"));
  }
  return `${groups.slice(0, 6).join(" ")} / ${groups.slice(6).join(" ")}`;
}
