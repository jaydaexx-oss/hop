/**
 * BLE message encoding / decoding.
 *
 * Over-the-air format (for this PoC):
 *   JSON-serialized EncryptedEnvelope → UTF-8 bytes → base64 string
 *
 * The GATT write value and the GATT read value are both base64 strings
 * because react-native-ble-plx works exclusively in base64.
 *
 * Encryption is NOT implemented in this PoC.  The `encrypted_payload`
 * field carries the plaintext content encoded as base64(utf8(text)).
 * A real implementation would XSalsa20-Poly1305 or similar here.
 *
 * MTU constraint:
 *   Default ATT MTU = 23 → max payload = 20 bytes.
 *   After MTU negotiation (512 requested) → max payload ≈ 509 bytes.
 *   We enforce a MAX_BLE_PAYLOAD_BYTES limit and reject messages that
 *   exceed it rather than implementing chunking in this PoC.
 *
 * Chunking is the next step; the framing byte [0x00, chunkIndex, totalChunks]
 * is reserved at the start of the buffer for that purpose.
 */

import type { EncryptedEnvelope } from '../transportManager';

/** Maximum on-wire size for a single BLE characteristic write (post-MTU). */
export const MAX_BLE_PAYLOAD_BYTES = 500;

// ─── Encode ───────────────────────────────────────────────────────────────────

/**
 * Encode a plaintext message for BLE transmission.
 *
 * For the PoC, the content is stored as base64(utf8(plaintext)) in the
 * encrypted_payload field.  Replace this with real encryption before release.
 */
export function encodeMessageContent(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

/**
 * Serialize an EncryptedEnvelope to a base64 string suitable for
 * writing to HOP_MESSAGE_CHAR.
 *
 * Returns null if the serialized form exceeds MAX_BLE_PAYLOAD_BYTES.
 */
export function envelopeToBase64(envelope: EncryptedEnvelope): string | null {
  const json = JSON.stringify(envelope);
  const bytes = Buffer.from(json, 'utf8');
  if (bytes.length > MAX_BLE_PAYLOAD_BYTES) return null;
  return bytes.toString('base64');
}

// ─── Decode ───────────────────────────────────────────────────────────────────

/**
 * Deserialize an EncryptedEnvelope from a base64 string received from
 * HOP_MESSAGE_CHAR.
 *
 * Returns null if parsing fails (malformed JSON, unknown fields, etc).
 */
export function envelopeFromBase64(base64: string): EncryptedEnvelope | null {
  try {
    const json = Buffer.from(base64, 'base64').toString('utf8');
    const obj = JSON.parse(json) as Partial<EncryptedEnvelope>;
    if (
      typeof obj.message_id !== 'string' ||
      typeof obj.sender_id !== 'string' ||
      typeof obj.recipient_id !== 'string' ||
      typeof obj.encrypted_payload !== 'string'
    ) {
      return null;
    }
    return obj as EncryptedEnvelope;
  } catch {
    return null;
  }
}

/**
 * Decode the plaintext content from an envelope's encrypted_payload.
 *
 * PoC only — real implementation would decrypt here.
 */
export function decodeMessageContent(encryptedPayload: string): string {
  try {
    return Buffer.from(encryptedPayload, 'base64').toString('utf8');
  } catch {
    return encryptedPayload; // fall back to raw string
  }
}
