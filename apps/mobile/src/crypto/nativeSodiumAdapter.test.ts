import { describe, expect, it } from "vitest";
import sodium from "libsodium-wrappers";

import { createNativeHopSodium } from "../../modules/hop-sodium/src/createNativeHopSodium";
import {
  fromOriginalBase64,
  toOriginalBase64,
  fromUtf8,
  toHex,
  toUtf8,
} from "../../modules/hop-sodium/src/encoding";
import {
  NACL_BOX_ALICE_PK,
  NACL_BOX_ALICE_PK_ORIGINAL_B64,
  NACL_BOX_ALICE_SK,
  NACL_BOX_MESSAGE,
  NACL_BOX_NONCE,
  NACL_BOX_BOB_PK,
  NACL_BOX_EASY_CIPHERTEXT,
} from "../../../../packages/protocol/tests/fixtures/libsodiumHopVectors.ts";

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

describe("HopSodium JS encoding helpers", () => {
  it("matches libsodium ORIGINAL base64, UTF-8, and hex", async () => {
    await sodium.ready;
    const pk = fromHex(NACL_BOX_ALICE_PK);
    expect(toOriginalBase64(pk)).toBe(NACL_BOX_ALICE_PK_ORIGINAL_B64);
    expect(toOriginalBase64(pk)).toBe(sodium.to_base64(pk, sodium.base64_variants.ORIGINAL));
    expect(Buffer.from(fromOriginalBase64(NACL_BOX_ALICE_PK_ORIGINAL_B64))).toEqual(Buffer.from(pk));
    const text = "hop-native-sodium";
    expect(Buffer.from(fromUtf8(text))).toEqual(Buffer.from(sodium.from_string(text)));
    expect(toUtf8(fromUtf8(text))).toBe(text);
    expect(toHex(pk)).toBe(sodium.to_hex(pk));
  });
});

describe("native adapter mapping", () => {
  it("preserves wrappers crypto_box bytes through the Expo module mapping", async () => {
    await sodium.ready;
    const adapter = createNativeHopSodium({
      crypto_box_NONCEBYTES: sodium.crypto_box_NONCEBYTES,
      crypto_box_PUBLICKEYBYTES: sodium.crypto_box_PUBLICKEYBYTES,
      crypto_box_SECRETKEYBYTES: sodium.crypto_box_SECRETKEYBYTES,
      crypto_box_MACBYTES: sodium.crypto_box_MACBYTES,
      crypto_box_BEFORENMBYTES: 32,
      crypto_auth_KEYBYTES: sodium.crypto_auth_KEYBYTES,
      crypto_auth_BYTES: sodium.crypto_auth_BYTES,
      version: "1.0.20",
      init: () => 0,
      cryptoBoxKeypair: () => sodium.crypto_box_keypair(),
      cryptoBoxEasy: (message, nonce, pk, sk) => sodium.crypto_box_easy(message, nonce, pk, sk),
      cryptoBoxOpenEasy: (ciphertext, nonce, pk, sk) =>
        sodium.crypto_box_open_easy(ciphertext, nonce, pk, sk),
      cryptoBoxBeforenm: (pk, sk) => sodium.crypto_box_beforenm(pk, sk),
      cryptoAuth: (message, key) => sodium.crypto_auth(message, key),
      cryptoAuthVerify: (mac, message, key) => sodium.crypto_auth_verify(mac, message, key),
      cryptoGenerichash: (outlen, message, key) => sodium.crypto_generichash(outlen, message, key ?? null),
      randomBytesBuf: (size) => sodium.randombytes_buf(size),
    });

    const boxed = adapter.crypto_box_easy(
      fromHex(NACL_BOX_MESSAGE),
      fromHex(NACL_BOX_NONCE),
      fromHex(NACL_BOX_BOB_PK),
      fromHex(NACL_BOX_ALICE_SK),
    );
    expect(adapter.to_hex(boxed)).toBe(NACL_BOX_EASY_CIPHERTEXT);
    expect(adapter.to_base64(fromHex(NACL_BOX_ALICE_PK), adapter.base64_variants.ORIGINAL)).toBe(
      NACL_BOX_ALICE_PK_ORIGINAL_B64,
    );
    const pair = adapter.crypto_box_keypair();
    expect(pair.publicKey).toBeInstanceOf(Uint8Array);
    expect(pair.privateKey).toBeInstanceOf(Uint8Array);
    expect(pair.publicKey.length).toBe(32);
    expect(pair.privateKey.length).toBe(32);
  });
});
