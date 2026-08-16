import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from "./bleCodec.js";
import { readySodium, type IdentityKeyPair } from "./cryptoBox.js";

const ACK_CONTEXT = "hop-ble-ack-v1";

export interface BleLinkAck {
  v: 1;
  message_id: string;
  from: string;
  nonce: string;
  mac: string;
}

export interface BleAckExpectation {
  message_id: string;
  from: string;
}

async function ackMacKey(local: IdentityKeyPair, peerPublicKey: string): Promise<Uint8Array> {
  const s = await readySodium();
  const variant = s.base64_variants.ORIGINAL;
  const shared = s.crypto_box_beforenm(
    s.from_base64(peerPublicKey, variant),
    s.from_base64(local.secretKey, variant),
  );
  return s.crypto_generichash(s.crypto_auth_KEYBYTES, shared, s.from_string(ACK_CONTEXT));
}

export async function encodeAuthenticatedBleAck(input: {
  message_id: string;
  from: string;
  local: IdentityKeyPair;
  peerPublicKey: string;
}): Promise<string> {
  const s = await readySodium();
  const variant = s.base64_variants.ORIGINAL;
  const nonce = s.to_base64(s.randombytes_buf(16), variant);
  const key = await ackMacKey(input.local, input.peerPublicKey);
  const mac = s.crypto_auth(s.from_string(`${input.message_id}|${input.from}|${nonce}`), key);
  const payload: BleLinkAck = {
    v: 1,
    message_id: input.message_id,
    from: input.from,
    nonce,
    mac: s.to_base64(mac, variant),
  };
  return bytesToHex(utf8ToBytes(JSON.stringify(payload)));
}

function parseAck(hex: string): BleLinkAck | null {
  try {
    const data = JSON.parse(bytesToUtf8(hexToBytes(hex))) as Partial<BleLinkAck>;
    if (
      data.v !== 1 ||
      typeof data.message_id !== "string" ||
      typeof data.from !== "string" ||
      typeof data.nonce !== "string" ||
      typeof data.mac !== "string"
    ) {
      return null;
    }
    return { v: 1, message_id: data.message_id, from: data.from, nonce: data.nonce, mac: data.mac };
  } catch {
    return null;
  }
}

/** UTF-8 message_id notifies from Phase 1 are unauthenticated and must be rejected. */
export function isUnauthenticatedBleAck(hex: string): boolean {
  return parseAck(hex) === null;
}

export async function verifyAuthenticatedBleAck(
  hex: string,
  expected: BleAckExpectation,
  local: IdentityKeyPair,
  peerPublicKey: string,
): Promise<boolean> {
  const ack = parseAck(hex);
  if (!ack) return false;
  if (ack.message_id !== expected.message_id || ack.from !== expected.from) return false;
  try {
    const s = await readySodium();
    const variant = s.base64_variants.ORIGINAL;
    const key = await ackMacKey(local, peerPublicKey);
    return s.crypto_auth_verify(
      s.from_base64(ack.mac, variant),
      s.from_string(`${ack.message_id}|${ack.from}|${ack.nonce}`),
      key,
    );
  } catch {
    return false;
  }
}
