import {
  assertHopSodium,
  NATIVE_SODIUM_MISSING,
  type HopSodium,
} from "./sodiumTypes.js";

export type { HopSodium } from "./sodiumTypes.js";
export { ORIGINAL_BASE64 } from "./sodiumTypes.js";

let readyPromise: Promise<HopSodium> | null = null;

export function setSodiumBackend(next: HopSodium): void {
  readyPromise = Promise.resolve(assertHopSodium(next));
}

export async function readySodium(): Promise<HopSodium> {
  if (readyPromise) return readyPromise;
  throw new Error(NATIVE_SODIUM_MISSING);
}
