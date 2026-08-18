import sodium from "libsodium-wrappers";

import {
  assertHopSodium,
  isNativeExpoOs,
  NATIVE_SODIUM_MISSING,
  type HopSodium,
} from "./sodiumTypes.js";

export type { HopSodium } from "./sodiumTypes.js";
export { ORIGINAL_BASE64 } from "./sodiumTypes.js";

/**
 * Protocol-facing libsodium surface. Callers must not import libsodium-wrappers
 * directly. Node/web use the official JS wrappers. Native iOS/Android inject
 * the hop-sodium Expo module (official libsodium C) via setSodiumBackend.
 */
let readyPromise: Promise<HopSodium> | null = null;

export function setSodiumBackend(next: HopSodium): void {
  readyPromise = Promise.resolve(assertHopSodium(next));
}

export async function readySodium(): Promise<HopSodium> {
  if (readyPromise) return readyPromise;
  if (isNativeExpoOs()) {
    throw new Error(NATIVE_SODIUM_MISSING);
  }
  readyPromise = Promise.resolve(sodium.ready).then(() => assertHopSodium(sodium as unknown as HopSodium));
  return readyPromise;
}
