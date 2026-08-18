import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import sodium from "libsodium-wrappers";

import {
  HOP_HS_AUTH,
  HOP_HS_GENERICHASH,
  NACL_BOX_ALICE_PK,
  NACL_BOX_ALICE_PK_ORIGINAL_B64,
  NACL_BOX_ALICE_SK,
  NACL_BOX_ALICE_SK_ORIGINAL_B64,
  NACL_BOX_BEFORENM,
  NACL_BOX_BOB_PK,
  NACL_BOX_BOB_SK,
  NACL_BOX_EASY_CIPHERTEXT,
  NACL_BOX_EASY_EMPTY_CIPHERTEXT,
  NACL_BOX_MESSAGE,
  NACL_BOX_NONCE,
} from "./fixtures/libsodiumHopVectors.js";

function fromHex(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

describe("libsodium JS wrappers vs official NaCl/libsodium vectors", () => {
  it("matches published crypto_box_easy and empty-message ciphertext", async () => {
    await sodium.ready;
    const boxed = sodium.crypto_box_easy(
      fromHex(NACL_BOX_MESSAGE),
      fromHex(NACL_BOX_NONCE),
      fromHex(NACL_BOX_BOB_PK),
      fromHex(NACL_BOX_ALICE_SK),
    );
    expect(Buffer.from(boxed).toString("hex")).toBe(NACL_BOX_EASY_CIPHERTEXT);
    expect(boxed.length).toBe(fromHex(NACL_BOX_MESSAGE).length + sodium.crypto_box_MACBYTES);
    const opened = sodium.crypto_box_open_easy(
      boxed,
      fromHex(NACL_BOX_NONCE),
      fromHex(NACL_BOX_ALICE_PK),
      fromHex(NACL_BOX_BOB_SK),
    );
    expect(Buffer.from(opened).toString("hex")).toBe(NACL_BOX_MESSAGE);

    const empty = sodium.crypto_box_easy(
      new Uint8Array(0),
      fromHex(NACL_BOX_NONCE),
      fromHex(NACL_BOX_BOB_PK),
      fromHex(NACL_BOX_ALICE_SK),
    );
    expect(Buffer.from(empty).toString("hex")).toBe(NACL_BOX_EASY_EMPTY_CIPHERTEXT);
  });

  it("matches beforenm, generichash, auth, and ORIGINAL identity encoding", async () => {
    await sodium.ready;
    const shared = sodium.crypto_box_beforenm(fromHex(NACL_BOX_BOB_PK), fromHex(NACL_BOX_ALICE_SK));
    const sharedBob = sodium.crypto_box_beforenm(fromHex(NACL_BOX_ALICE_PK), fromHex(NACL_BOX_BOB_SK));
    expect(Buffer.from(shared).toString("hex")).toBe(NACL_BOX_BEFORENM);
    expect(Buffer.from(sharedBob).toString("hex")).toBe(NACL_BOX_BEFORENM);
    const key = sodium.crypto_generichash(32, shared, sodium.from_string("hop-ble-hs-v3"));
    expect(Buffer.from(key).toString("hex")).toBe(HOP_HS_GENERICHASH);
    const mac = sodium.crypto_auth(sodium.from_string("transcript"), key);
    expect(Buffer.from(mac).toString("hex")).toBe(HOP_HS_AUTH);
    expect(sodium.crypto_auth_verify(mac, sodium.from_string("transcript"), key)).toBe(true);
    expect(sodium.to_base64(fromHex(NACL_BOX_ALICE_PK), sodium.base64_variants.ORIGINAL)).toBe(
      NACL_BOX_ALICE_PK_ORIGINAL_B64,
    );
    expect(sodium.to_base64(fromHex(NACL_BOX_ALICE_SK), sodium.base64_variants.ORIGINAL)).toBe(
      NACL_BOX_ALICE_SK_ORIGINAL_B64,
    );
  });
});

describe("native hop-sodium C host vs the same vectors", () => {
  it("compiles official libsodium C and matches the fixtures", () => {
    const script = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../apps/mobile/modules/hop-sodium/scripts/run-host-vectors.sh",
    );
    const result = spawnSync("sh", [script], { encoding: "utf8", timeout: 180_000 });
    if (result.error) {
      throw result.error;
    }
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("hop-sodium host vectors ok (libsodium 1.0.20)");
  }, 180_000);

  it("does not load the Expo native module in Node", async () => {
    await sodium.ready;
    expect(process.env.EXPO_OS).not.toBe("ios");
    expect(process.env.EXPO_OS).not.toBe("android");
  });
});
