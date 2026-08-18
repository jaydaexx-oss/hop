import { requireOptionalNativeModule } from "expo-modules-core";

export type HopSodiumNativeModule = {
  crypto_box_NONCEBYTES: number;
  crypto_box_PUBLICKEYBYTES: number;
  crypto_box_SECRETKEYBYTES: number;
  crypto_box_MACBYTES: number;
  crypto_box_BEFORENMBYTES: number;
  crypto_auth_KEYBYTES: number;
  crypto_auth_BYTES: number;
  version?: string;
  init(): number;
  cryptoBoxKeypair(): { publicKey: Uint8Array; privateKey: Uint8Array };
  cryptoBoxEasy(message: Uint8Array, nonce: Uint8Array, pk: Uint8Array, sk: Uint8Array): Uint8Array;
  cryptoBoxOpenEasy(ciphertext: Uint8Array, nonce: Uint8Array, pk: Uint8Array, sk: Uint8Array): Uint8Array;
  cryptoBoxBeforenm(pk: Uint8Array, sk: Uint8Array): Uint8Array;
  cryptoAuth(message: Uint8Array, key: Uint8Array): Uint8Array;
  cryptoAuthVerify(mac: Uint8Array, message: Uint8Array, key: Uint8Array): boolean;
  cryptoGenerichash(outlen: number, message: Uint8Array, key?: Uint8Array | null): Uint8Array;
  randomBytesBuf(size: number): Uint8Array;
};

export function getHopSodiumNativeModule(): HopSodiumNativeModule | null {
  return requireOptionalNativeModule<HopSodiumNativeModule>("HopSodium");
}

export function isNativeHopSodiumAvailable(): boolean {
  const native = getHopSodiumNativeModule();
  return native != null && typeof native.cryptoBoxBeforenm === "function";
}

export { createNativeHopSodium } from "./createNativeHopSodium";
