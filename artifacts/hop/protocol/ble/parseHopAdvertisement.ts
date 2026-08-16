/**
 * parseHopAdvertisement — HOP BLE manufacturer-data parser.
 *
 * Extracts tempIdHex and protocolVersion from the base64-encoded
 * manufacturerData field returned by react-native-ble-plx.
 *
 * Buffer layout (from HOP BLE spec):
 *   bytes[0..1]  = company ID, uint16 little-endian (must equal HOP_COMPANY_ID)
 *   bytes[2]     = HOP protocol version (must equal HOP_BLE_PROTOCOL_VERSION)
 *   bytes[3..18] = tempId (16 bytes)
 *
 * Uses atob() for base64 decoding — works on React Native/Hermes without a
 * Buffer polyfill (atob is available since RN 0.67 / Hermes bundled builds).
 */

import {
  HOP_COMPANY_ID,
  HOP_BLE_PROTOCOL_VERSION,
  MFR_OFFSET_COMPANY_ID,
  MFR_OFFSET_VERSION,
  MFR_OFFSET_TEMP_ID,
  MFR_TEMP_ID_LENGTH,
} from './constants';
import { bytesToHex } from './tempId';

export interface ParsedHopAdvertisement {
  tempIdHex: string;
  protocolVersion: number;
}

/**
 * Converts a base64 string to a Uint8Array using atob().
 * Returns null if the string is not valid base64.
 */
function base64ToBytes(base64: string): Uint8Array | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Parses a base64-encoded manufacturer data string from react-native-ble-plx.
 *
 * Returns null if the data is absent, too short, or not from a HOP device
 * (wrong company ID or unsupported protocol version).
 */
export function parseHopAdvertisement(
  manufacturerDataBase64: string | null | undefined,
): ParsedHopAdvertisement | null {
  if (!manufacturerDataBase64) return null;

  const bytes = base64ToBytes(manufacturerDataBase64);
  if (!bytes) return null;

  const minLen = MFR_OFFSET_TEMP_ID + MFR_TEMP_ID_LENGTH;
  if (bytes.length < minLen) return null;

  // Validate company ID (little-endian uint16: low byte first, high byte second).
  const companyId = bytes[MFR_OFFSET_COMPANY_ID] | (bytes[MFR_OFFSET_COMPANY_ID + 1] << 8);
  if (companyId !== HOP_COMPANY_ID) return null;

  // Validate protocol version.
  const protocolVersion = bytes[MFR_OFFSET_VERSION];
  if (protocolVersion !== HOP_BLE_PROTOCOL_VERSION) return null;

  // Extract tempId bytes (16 bytes starting at MFR_OFFSET_TEMP_ID).
  const tempIdBytes = bytes.subarray(MFR_OFFSET_TEMP_ID, MFR_OFFSET_TEMP_ID + MFR_TEMP_ID_LENGTH);

  return {
    tempIdHex: bytesToHex(tempIdBytes),
    protocolVersion,
  };
}
