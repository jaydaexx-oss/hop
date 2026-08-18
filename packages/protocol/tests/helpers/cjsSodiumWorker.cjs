"use strict";

/**
 * Loads official CJS libsodium-wrappers with Hermes-like missing WebAssembly
 * so ready() uses the wasm2js backup. Runs out of process so the WASM probe
 * rejection cannot fail the parent Vitest worker.
 */
process.on("unhandledRejection", (reason) => {
  const text = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
  if (/WebAssembly/.test(text) && /doesn['’]t exist|is not defined/i.test(text)) return;
  console.error(reason);
  process.exit(1);
});

Object.defineProperty(globalThis, "WebAssembly", {
  configurable: true,
  get() {
    throw new ReferenceError("Property 'WebAssembly' doesn't exist");
  },
});

const sodium = require("libsodium-wrappers");

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function u8(b64s) {
  return new Uint8Array(Buffer.from(b64s, "base64"));
}

function handle(msg) {
  const v = sodium.base64_variants.ORIGINAL;
  switch (msg.op) {
    case "info":
      return {
        nonce: sodium.crypto_box_NONCEBYTES,
        pk: sodium.crypto_box_PUBLICKEYBYTES,
        sk: sodium.crypto_box_SECRETKEYBYTES,
        mac: sodium.crypto_box_MACBYTES,
        hasBeforenm: typeof sodium.crypto_box_beforenm === "function",
        hasAuth: typeof sodium.crypto_auth === "function",
        hasHash: typeof sodium.crypto_generichash === "function",
        wrappersPath: require.resolve("libsodium-wrappers"),
        libsodiumPath: require.resolve("libsodium"),
      };
    case "keypair": {
      const pair = sodium.crypto_box_keypair();
      return { publicKey: b64(pair.publicKey), secretKey: b64(pair.privateKey) };
    }
    case "random_nonce":
      return { nonce: b64(sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES)) };
    case "box":
      return {
        ciphertext: b64(
          sodium.crypto_box_easy(u8(msg.message), u8(msg.nonce), u8(msg.pk), u8(msg.sk)),
        ),
      };
    case "open":
      return {
        message: b64(
          sodium.crypto_box_open_easy(u8(msg.ciphertext), u8(msg.nonce), u8(msg.pk), u8(msg.sk)),
        ),
      };
    case "beforenm":
      return { shared: b64(sodium.crypto_box_beforenm(u8(msg.pk), u8(msg.sk))) };
    case "generichash":
      return {
        digest: b64(sodium.crypto_generichash(msg.outlen, u8(msg.message), msg.key ? u8(msg.key) : null)),
      };
    case "auth":
      return { mac: b64(sodium.crypto_auth(u8(msg.message), u8(msg.key))) };
    case "auth_verify":
      return { ok: sodium.crypto_auth_verify(u8(msg.mac), u8(msg.message), u8(msg.key)) };
    case "encrypt_app": {
      const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
      const ciphertext = sodium.crypto_box_easy(
        sodium.from_string(msg.plainJson),
        nonce,
        sodium.from_base64(msg.recipientPk, v),
        sodium.from_base64(msg.senderSk, v),
      );
      return {
        payload: JSON.stringify({
          v: 1,
          alg: "crypto_box_xsalsa20poly1305",
          sender_pk: msg.senderPk,
          nonce: sodium.to_base64(nonce, v),
          ciphertext: sodium.to_base64(ciphertext, v),
        }),
      };
    }
    case "decrypt_app": {
      const parsed = JSON.parse(msg.payload);
      const opened = sodium.crypto_box_open_easy(
        sodium.from_base64(parsed.ciphertext, v),
        sodium.from_base64(parsed.nonce, v),
        sodium.from_base64(parsed.sender_pk, v),
        sodium.from_base64(msg.recipientSk, v),
      );
      return { plainJson: sodium.to_string(opened) };
    }
    case "handshake_mac": {
      const shared = sodium.crypto_box_beforenm(
        sodium.from_base64(msg.peerPk, v),
        sodium.from_base64(msg.localSk, v),
      );
      const key = sodium.crypto_generichash(
        sodium.crypto_auth_KEYBYTES,
        shared,
        sodium.from_string("hop-ble-hs-v3"),
      );
      const body = {
        v: 3,
        user_id: msg.userId,
        username: msg.username,
        pk: msg.localPk,
        n: msg.nonce,
        ts: msg.ts,
        peer_pk: msg.peerPk,
        auth: "",
      };
      const transcript = [
        "hop-ble-hs-v3",
        body.v,
        body.user_id,
        body.username,
        body.pk,
        body.n,
        String(body.ts),
        body.peer_pk,
      ].join("|");
      body.auth = sodium.to_base64(sodium.crypto_auth(sodium.from_string(transcript), key), v);
      return { payload: JSON.stringify(body) };
    }
    case "handshake_verify": {
      const parsed = JSON.parse(msg.payload);
      const shared = sodium.crypto_box_beforenm(
        sodium.from_base64(parsed.pk, v),
        sodium.from_base64(msg.localSk, v),
      );
      const key = sodium.crypto_generichash(
        sodium.crypto_auth_KEYBYTES,
        shared,
        sodium.from_string("hop-ble-hs-v3"),
      );
      const transcript = [
        "hop-ble-hs-v3",
        parsed.v,
        parsed.user_id,
        parsed.username,
        parsed.pk,
        parsed.n,
        String(parsed.ts),
        parsed.peer_pk,
      ].join("|");
      return {
        ok: sodium.crypto_auth_verify(
          sodium.from_base64(parsed.auth, v),
          sodium.from_string(transcript),
          key,
        ),
      };
    }
    default:
      throw new Error(`unknown op ${msg.op}`);
  }
}

sodium.ready.then(() => {
  process.send({ id: 0, ready: true });
  process.on("message", (msg) => {
    try {
      process.send({ id: msg.id, result: handle(msg) });
    } catch (error) {
      process.send({ id: msg.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
});
