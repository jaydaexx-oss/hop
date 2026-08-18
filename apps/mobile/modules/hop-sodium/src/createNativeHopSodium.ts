import type { HopSodium } from "@hop/protocol";

import { fromOriginalBase64, fromUtf8, toHex, toOriginalBase64, toU8, toUtf8 } from "./encoding";
import type { HopSodiumNativeModule } from "./HopSodiumModule";

const ORIGINAL = 1 as const;

function requireBytes(name: string, value: Uint8Array, size: number): Uint8Array {
  const bytes = toU8(value);
  if (bytes.length !== size) {
    throw new Error(`libsodium ${name} expected ${size} bytes`);
  }
  return bytes;
}

export function createNativeHopSodium(native: HopSodiumNativeModule): HopSodium {
  if (typeof native.init === "function") {
    native.init();
  }
  if (native.version && native.version !== "1.0.20") {
    throw new Error(`Unexpected native libsodium version ${native.version}`);
  }

  const adapter: HopSodium = {
    crypto_box_NONCEBYTES: native.crypto_box_NONCEBYTES,
    crypto_box_PUBLICKEYBYTES: native.crypto_box_PUBLICKEYBYTES,
    crypto_box_SECRETKEYBYTES: native.crypto_box_SECRETKEYBYTES,
    crypto_box_MACBYTES: native.crypto_box_MACBYTES,
    crypto_box_BEFORENMBYTES: native.crypto_box_BEFORENMBYTES,
    crypto_auth_KEYBYTES: native.crypto_auth_KEYBYTES,
    crypto_auth_BYTES: native.crypto_auth_BYTES,
    base64_variants: { ORIGINAL },
    crypto_box_keypair() {
      const pair = native.cryptoBoxKeypair();
      return {
        publicKey: toU8(pair.publicKey),
        privateKey: toU8(pair.privateKey),
      };
    },
    crypto_box_easy(message, nonce, pk, sk) {
      return toU8(
        native.cryptoBoxEasy(
          toU8(message),
          requireBytes("nonce", nonce, native.crypto_box_NONCEBYTES),
          requireBytes("pk", pk, native.crypto_box_PUBLICKEYBYTES),
          requireBytes("sk", sk, native.crypto_box_SECRETKEYBYTES),
        ),
      );
    },
    crypto_box_open_easy(ciphertext, nonce, pk, sk) {
      const opened = native.cryptoBoxOpenEasy(
        toU8(ciphertext),
        requireBytes("nonce", nonce, native.crypto_box_NONCEBYTES),
        requireBytes("pk", pk, native.crypto_box_PUBLICKEYBYTES),
        requireBytes("sk", sk, native.crypto_box_SECRETKEYBYTES),
      );
      if (!opened) {
        throw new Error("crypto_box_open_easy failed");
      }
      return toU8(opened);
    },
    crypto_box_beforenm(pk, sk) {
      return toU8(
        native.cryptoBoxBeforenm(
          requireBytes("pk", pk, native.crypto_box_PUBLICKEYBYTES),
          requireBytes("sk", sk, native.crypto_box_SECRETKEYBYTES),
        ),
      );
    },
    crypto_auth(message, key) {
      return toU8(native.cryptoAuth(toU8(message), requireBytes("key", key, native.crypto_auth_KEYBYTES)));
    },
    crypto_auth_verify(mac, message, key) {
      return native.cryptoAuthVerify(
        requireBytes("mac", mac, native.crypto_auth_BYTES),
        toU8(message),
        requireBytes("key", key, native.crypto_auth_KEYBYTES),
      );
    },
    crypto_generichash(outlen, message, key) {
      const keyBytes = key == null ? null : toU8(key);
      return toU8(native.cryptoGenerichash(outlen, toU8(message), keyBytes));
    },
    randombytes_buf(length) {
      return toU8(native.randomBytesBuf(length));
    },
    from_base64(input, variant) {
      if (variant != null && variant !== ORIGINAL) {
        throw new Error("Native HopSodium only supports base64_variants.ORIGINAL");
      }
      return fromOriginalBase64(input);
    },
    to_base64(bytes, variant) {
      if (variant != null && variant !== ORIGINAL) {
        throw new Error("Native HopSodium only supports base64_variants.ORIGINAL");
      }
      return toOriginalBase64(toU8(bytes));
    },
    from_string: fromUtf8,
    to_string: toUtf8,
    to_hex: (bytes) => toHex(toU8(bytes)),
  };
  return adapter;
}
