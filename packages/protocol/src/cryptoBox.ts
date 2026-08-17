import sodium from "libsodium-wrappers";
import { ACK_PROTOCOL_VERSION, assertAckPlain, compactAckPlaintext, type AckType } from "./acks.js";

/** libsodium NaCl crypto_box (X25519 + XSalsa20-Poly1305). Not a custom construction. */

export const CRYPTO_BOX_ALG = "crypto_box_xsalsa20poly1305";
export const CRYPTO_BOX_PUBLICKEYBYTES = 32;

/** Sync structural check: standard base64 of exactly 32 bytes. Does not prove possession. */
export function isWellFormedBoxPublicKey(pk: string): boolean {
  if (typeof pk !== "string" || !pk) return false;
  if (pk.trim() !== pk) return false;
  if (/[\s]/.test(pk)) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(pk)) return false;
  try {
    const binary = globalThis.atob(pk);
    if (binary.length !== CRYPTO_BOX_PUBLICKEYBYTES) return false;
    const roundtrip = globalThis.btoa(binary);
    return roundtrip === pk || roundtrip.replace(/=+$/, "") === pk.replace(/=+$/, "");
  } catch {
    return false;
  }
}

export interface IdentityKeyPair {
  publicKey: string;
  secretKey: string;
}

export type ApplicationKind = "message" | "delivery_ack" | "voice";

export interface ApplicationPlaintext {
  message_id: string;
  sender_id: string;
  recipient_id: string;
  conversation_id: string;
  /** Caption for voice; body for text. Decrypt requires a string. */
  text: string;
  created_at: string;
  expires_at: string;
  ttl: number;
  hop_count: number;
  kind?: ApplicationKind;
  ack_of?: string;
  /** Cryptographic delivery/read receipt. Absent on normal messages. */
  ack_status?: "DELIVERED" | "READ";
  /** Explicit receipt type. Preferred over ack_status; both must agree when present. */
  ack_type?: AckType;
  /** Receipt protocol version. Current: 1. */
  ack_v?: number;
  /** Base64 audio for kind=voice. Canonical field for this and future chunked PTT. */
  audio_b64?: string;
  /** Alias accepted on encrypt/decrypt so a later chunked slice can rename without a format break. */
  audio?: string;
  duration_ms?: number;
  mime?: string;
  codec?: string;
  /** Future chunk index. First slice sends a single clip as seq=0. */
  seq?: number;
  /** Per-conversation monotonic send sequence. Optional; old messages omit it. */
  send_seq?: number;
  /** Future chunk count. First slice sends a single clip as total=1. */
  total?: number;
  /** Future stream/session id for multi-chunk PTT. Omitted on a complete single clip. */
  part_of?: string;
}

export interface CryptoBoxPayload {
  v: 1;
  alg: typeof CRYPTO_BOX_ALG;
  sender_pk: string;
  nonce: string;
  ciphertext: string;
}

let readyPromise: Promise<typeof sodium> | null = null;

export async function readySodium(): Promise<typeof sodium> {
  if (!readyPromise) {
    readyPromise = Promise.resolve(sodium.ready).then(() => sodium);
  }
  return readyPromise;
}

export async function generateIdentityKeyPair(): Promise<IdentityKeyPair> {
  const s = await readySodium();
  const pair = s.crypto_box_keypair();
  const variant = s.base64_variants.ORIGINAL;
  return {
    publicKey: s.to_base64(pair.publicKey, variant),
    secretKey: s.to_base64(pair.privateKey, variant),
  };
}

function voiceAudioValue(plain: ApplicationPlaintext): string {
  const value = plain.audio_b64 ?? plain.audio ?? "";
  return typeof value === "string" ? value : "";
}

export async function encryptApplicationMessage(
  plain: ApplicationPlaintext,
  recipientPublicKey: string,
  sender: IdentityKeyPair,
): Promise<string> {
  let sealed = plain;
  if (plain.kind === "voice") {
    if (!voiceAudioValue(plain)) {
      throw new Error("Refusing to encrypt voice with no audio");
    }
  } else if (plain.kind === "delivery_ack") {
    sealed = compactAckPlaintext(plain, assertAckPlain({ ...plain, ack_v: plain.ack_v ?? ACK_PROTOCOL_VERSION }));
  } else if (!plain.text.trim()) {
    throw new Error("Refusing to encrypt empty plaintext");
  }
  const s = await readySodium();
  const variant = s.base64_variants.ORIGINAL;
  const nonce = s.randombytes_buf(s.crypto_box_NONCEBYTES);
  const ciphertext = s.crypto_box_easy(
    s.from_string(JSON.stringify(sealed)),
    nonce,
    s.from_base64(recipientPublicKey, variant),
    s.from_base64(sender.secretKey, variant),
  );
  const payload: CryptoBoxPayload = {
    v: 1,
    alg: CRYPTO_BOX_ALG,
    sender_pk: sender.publicKey,
    nonce: s.to_base64(nonce, variant),
    ciphertext: s.to_base64(ciphertext, variant),
  };
  return JSON.stringify(payload);
}

export interface DecryptOptions {
  expectedSenderId?: string;
  expectedRecipientId?: string;
  tofu?: { bind(userId: string, publicKey: string): boolean };
}

export async function decryptApplicationMessage(
  encryptedPayload: string,
  recipient: IdentityKeyPair,
  expectedSenderPk?: string,
  expectedMessageId?: string,
  options?: DecryptOptions,
): Promise<ApplicationPlaintext> {
  const parsed = parseCryptoBoxPayload(encryptedPayload);
  if (!parsed) {
    throw new Error("Not a libsodium crypto_box payload");
  }
  if (expectedSenderPk && expectedSenderPk !== parsed.sender_pk) {
    throw new Error("Sender public key does not match the handshake session");
  }
  const s = await readySodium();
  const variant = s.base64_variants.ORIGINAL;
  const opened = s.crypto_box_open_easy(
    s.from_base64(parsed.ciphertext, variant),
    s.from_base64(parsed.nonce, variant),
    s.from_base64(parsed.sender_pk, variant),
    s.from_base64(recipient.secretKey, variant),
  );
  const plain = JSON.parse(s.to_string(opened)) as ApplicationPlaintext;
  if (!plain?.message_id || typeof plain.text !== "string") {
    throw new Error("Decrypted payload is not a HOP application message");
  }
  if (plain.kind === "delivery_ack") {
    assertAckPlain(plain);
  }
  if (expectedMessageId && plain.message_id !== expectedMessageId) {
    throw new Error("Authenticated message_id does not match the envelope");
  }
  if (options?.expectedSenderId && plain.sender_id !== options.expectedSenderId) {
    throw new Error("Authenticated sender_id does not match the envelope");
  }
  if (options?.expectedRecipientId && plain.recipient_id !== options.expectedRecipientId) {
    throw new Error("Authenticated recipient_id does not match this device");
  }
  if (options?.tofu && !options.tofu.bind(plain.sender_id, parsed.sender_pk)) {
    throw new Error("Sender public key does not match the bound identity");
  }
  return plain;
}

export function parseCryptoBoxPayload(encryptedPayload: string): CryptoBoxPayload | null {
  try {
    const data = JSON.parse(encryptedPayload) as Partial<CryptoBoxPayload>;
    if (
      data.v !== 1 ||
      data.alg !== CRYPTO_BOX_ALG ||
      typeof data.sender_pk !== "string" ||
      typeof data.nonce !== "string" ||
      typeof data.ciphertext !== "string"
    ) {
      return null;
    }
    return {
      v: 1,
      alg: CRYPTO_BOX_ALG,
      sender_pk: data.sender_pk,
      nonce: data.nonce,
      ciphertext: data.ciphertext,
    };
  } catch {
    return null;
  }
}

export function isCryptoBoxPayload(encryptedPayload: string): boolean {
  return parseCryptoBoxPayload(encryptedPayload) !== null;
}
