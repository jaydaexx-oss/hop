/**
 * Future identity recovery — architecture only.
 *
 * Onboarding must not require any of these paths. A lost identity secret still
 * means a new account today (`SERVER_KEY_LOCKED`); the server will not accept
 * an unauthenticated public-key replacement.
 *
 * Suggested later (do not build UX now):
 * - Recovery code printed once, wrapping the identity secret
 * - iCloud Keychain / device backup of `hop.box.{userId}`
 * - Optional email/phone as a lookup handle, never as the crypto identity
 *
 * Any rotation API must prove possession of the prior secret before the
 * published identity public key can change. Username is a display handle only
 * and must never be used to derive encryption keys.
 */

export type IdentityRecoveryMethod = "recovery_code" | "icloud_keychain" | "email" | "phone";

export interface IdentityRecoveryPlan {
  method: IdentityRecoveryMethod;
  /** Must prove possession of the prior identity secret before the server accepts a new public key. */
  provesPriorSecret: true;
}

/** Onboarding is device-local identity + handle. Recovery is optional and later. */
export function recoveryNotRequiredForOnboarding(): true {
  return true;
}

export const IDENTITY_RECOVERY_EXTENSION_POINTS = [
  "recovery_code",
  "icloud_keychain",
  "optional_email",
  "optional_phone",
] as const;
