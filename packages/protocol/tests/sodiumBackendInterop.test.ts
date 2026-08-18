import { fork, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import sodiumEsm from "libsodium-wrappers";

import { encodeAuthenticatedHandshake, verifyAuthenticatedHandshake } from "../src/bleHandshake.js";
import { HandshakeReplayGuard } from "../src/bleGuard.js";
import { decryptApplicationMessage, encryptApplicationMessage } from "../src/cryptoBox.js";
import { createMessageId } from "../src/ids.js";

const workerPath = new URL("./helpers/cjsSodiumWorker.cjs", import.meta.url);

let worker: ChildProcess;
let nextId = 1;

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function u8(b64s: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64s, "base64"));
}

function callCjs<T>(payload: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (msg: { id?: number; result?: T; error?: string }) => {
      if (msg.id !== id) return;
      worker.off("message", onMessage);
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.result as T);
    };
    worker.on("message", onMessage);
    worker.send({ id, ...payload });
  });
}

describe("official libsodium ESM wasm vs native CJS wasm2js", () => {
  beforeAll(async () => {
    await sodiumEsm.ready;
    worker = fork(workerPath, { stdio: ["ignore", "inherit", "inherit", "ipc"] });
    await new Promise<void>((resolve, reject) => {
      const onMessage = (msg: { ready?: boolean }) => {
        if (!msg.ready) return;
        worker.off("message", onMessage);
        resolve();
      };
      worker.on("message", onMessage);
      worker.once("exit", (code) => reject(new Error(`cjs sodium worker exited ${code}`)));
    });
  }, 30_000);

  afterAll(() => {
    worker.kill();
  });

  it("uses the CJS wasm2js backup when WebAssembly is missing", async () => {
    const info = await callCjs<{
      nonce: number;
      pk: number;
      sk: number;
      mac: number;
      hasBeforenm: boolean;
      hasAuth: boolean;
      hasHash: boolean;
      wrappersPath: string;
      libsodiumPath: string;
    }>({ op: "info" });
    expect(info.wrappersPath.replaceAll("\\", "/")).toMatch(/dist\/modules\/libsodium-wrappers\.js$/);
    expect(info.libsodiumPath.replaceAll("\\", "/")).toMatch(/dist\/modules\/libsodium\.js$/);
    expect(info.wrappersPath).not.toMatch(/modules-esm/);
    expect(info.nonce).toBe(24);
    expect(info.pk).toBe(32);
    expect(info.sk).toBe(32);
    expect(info.mac).toBe(16);
    expect(info.hasBeforenm).toBe(true);
    expect(info.hasAuth).toBe(true);
    expect(info.hasHash).toBe(true);
  });

  it("round-trips crypto_box_easy between ESM wasm and CJS wasm2js", async () => {
    const alice = sodiumEsm.crypto_box_keypair();
    const blake = await callCjs<{ publicKey: string; secretKey: string }>({ op: "keypair" });
    const message = sodiumEsm.from_string("hop-native-sodium-interop");
    const nonce = sodiumEsm.randombytes_buf(sodiumEsm.crypto_box_NONCEBYTES);

    const boxed = sodiumEsm.crypto_box_easy(message, nonce, u8(blake.publicKey), alice.privateKey);
    expect(boxed.length).toBe(message.length + sodiumEsm.crypto_box_MACBYTES);
    const opened = await callCjs<{ message: string }>({
      op: "open",
      ciphertext: b64(boxed),
      nonce: b64(nonce),
      pk: b64(alice.publicKey),
      sk: blake.secretKey,
    });
    expect(sodiumEsm.to_string(u8(opened.message))).toBe("hop-native-sodium-interop");

    const nonce2 = await callCjs<{ nonce: string }>({ op: "random_nonce" });
    const boxed2 = await callCjs<{ ciphertext: string }>({
      op: "box",
      message: b64(message),
      nonce: nonce2.nonce,
      pk: b64(alice.publicKey),
      sk: blake.secretKey,
    });
    const opened2 = sodiumEsm.crypto_box_open_easy(
      u8(boxed2.ciphertext),
      u8(nonce2.nonce),
      u8(blake.publicKey),
      alice.privateKey,
    );
    expect(sodiumEsm.to_string(opened2)).toBe("hop-native-sodium-interop");
  });

  it("agrees on crypto_box_beforenm and crypto_auth across backends", async () => {
    const alice = sodiumEsm.crypto_box_keypair();
    const blake = await callCjs<{ publicKey: string; secretKey: string }>({ op: "keypair" });
    const sharedEsm = sodiumEsm.crypto_box_beforenm(u8(blake.publicKey), alice.privateKey);
    const sharedCjs = await callCjs<{ shared: string }>({
      op: "beforenm",
      pk: b64(alice.publicKey),
      sk: blake.secretKey,
    });
    expect(Buffer.from(sharedEsm)).toEqual(Buffer.from(u8(sharedCjs.shared)));

    const key = sodiumEsm.crypto_generichash(
      sodiumEsm.crypto_auth_KEYBYTES,
      sharedEsm,
      sodiumEsm.from_string("hop-ble-hs-v3"),
    );
    const mac = sodiumEsm.crypto_auth(sodiumEsm.from_string("transcript"), key);
    const ok = await callCjs<{ ok: boolean }>({
      op: "auth_verify",
      mac: b64(mac),
      message: b64(sodiumEsm.from_string("transcript")),
      key: b64(key),
    });
    expect(ok.ok).toBe(true);
    const bad = await callCjs<{ ok: boolean }>({
      op: "auth_verify",
      mac: b64(mac),
      message: b64(sodiumEsm.from_string("tampered")),
      key: b64(key),
    });
    expect(bad.ok).toBe(false);
  });

  it("opens application crypto_box JSON produced by the other backend", async () => {
    const alicePair = sodiumEsm.crypto_box_keypair();
    const esmAlice = {
      publicKey: sodiumEsm.to_base64(alicePair.publicKey, sodiumEsm.base64_variants.ORIGINAL),
      secretKey: sodiumEsm.to_base64(alicePair.privateKey, sodiumEsm.base64_variants.ORIGINAL),
    };
    const cjsBlake = await callCjs<{ publicKey: string; secretKey: string }>({ op: "keypair" });
    const plain = {
      message_id: createMessageId(),
      sender_id: "alice",
      recipient_id: "blake",
      conversation_id: "ble:alice:blake",
      text: "cross-backend application box",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      ttl: 60_000,
      hop_count: 0,
    };

    const packedByDefault = await encryptApplicationMessage(plain, cjsBlake.publicKey, esmAlice);
    const openedByCjs = await callCjs<{ plainJson: string }>({
      op: "decrypt_app",
      payload: packedByDefault,
      recipientSk: cjsBlake.secretKey,
    });
    expect(JSON.parse(openedByCjs.plainJson)).toMatchObject({ text: plain.text, message_id: plain.message_id });

    const packedByCjs = await callCjs<{ payload: string }>({
      op: "encrypt_app",
      plainJson: JSON.stringify(plain),
      recipientPk: esmAlice.publicKey,
      senderPk: cjsBlake.publicKey,
      senderSk: cjsBlake.secretKey,
    });
    const openedByDefault = await decryptApplicationMessage(
      packedByCjs.payload,
      esmAlice,
      cjsBlake.publicKey,
      plain.message_id,
    );
    expect(openedByDefault.text).toBe(plain.text);
  });

  it("verifies a BLE handshake MAC across backends", async () => {
    const alicePair = sodiumEsm.crypto_box_keypair();
    const alice = {
      publicKey: sodiumEsm.to_base64(alicePair.publicKey, sodiumEsm.base64_variants.ORIGINAL),
      secretKey: sodiumEsm.to_base64(alicePair.privateKey, sodiumEsm.base64_variants.ORIGINAL),
    };
    const blake = await callCjs<{ publicKey: string; secretKey: string }>({ op: "keypair" });
    const packed = await encodeAuthenticatedHandshake({
      local: alice,
      userId: "alice",
      username: "alice",
      nonce: "dGVzdC1ub25jZQ==",
      ts: Date.now(),
      peerPublicKey: blake.publicKey,
    });
    const cjsVerified = await callCjs<{ ok: boolean }>({
      op: "handshake_verify",
      payload: packed,
      localSk: blake.secretKey,
    });
    expect(cjsVerified.ok).toBe(true);

    const packedCjs = await callCjs<{ payload: string }>({
      op: "handshake_mac",
      localPk: blake.publicKey,
      localSk: blake.secretKey,
      peerPk: alice.publicKey,
      userId: "blake",
      username: "blake",
      nonce: "Ymxha2Utbm9uY2U=",
      ts: Date.now(),
    });
    const verifiedEsm = await verifyAuthenticatedHandshake({
      raw: packedCjs.payload,
      local: alice,
      replay: new HandshakeReplayGuard(),
    });
    expect(verifiedEsm.ok).toBe(true);
  });
});
