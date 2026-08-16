/**
 * Tests for protocol/ble/parseHopAdvertisement.ts
 *
 * Verifies that the HOP advertisement parser correctly decodes real base64
 * manufacturer data without relying on Node's Buffer — using the same
 * atob()-based decoder that runs on React Native / Hermes.
 *
 * Test vectors computed from the HOP BLE spec:
 *   bytes[0..1]  company ID = 0x4850 (LE → 0x50, 0x48)
 *   bytes[2]     protocol version = 0x01
 *   bytes[3..18] tempId (16 bytes)
 */

import { parseHopAdvertisement } from '../protocol/ble/parseHopAdvertisement';

// ── Test vectors (generated with Node's Buffer for ground truth) ──────────────
//
//   bytes = [0x50, 0x48, 0x01,  <- company ID (LE) + version
//            0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,
//            0x09,0x0a,0x0b,0x0c,0x0d,0x0e,0x0f,0x10]
//   base64 = "UEgBAQIDBAUGBwgJCgsMDQ4PEA=="
//   tempIdHex expected = "0102030405060708090a0b0c0d0e0f10"

const VALID_BASE64 = 'UEgBAQIDBAUGBwgJCgsMDQ4PEA==';
const VALID_TEMP_ID_HEX = '0102030405060708090a0b0c0d0e0f10';

describe('parseHopAdvertisement', () => {
  // ── Happy path ──────────────────────────────────────────────────────────────

  it('parses a valid HOP advertisement and returns tempIdHex + protocolVersion', () => {
    const result = parseHopAdvertisement(VALID_BASE64);
    expect(result).not.toBeNull();
    expect(result!.tempIdHex).toBe(VALID_TEMP_ID_HEX);
    expect(result!.protocolVersion).toBe(1);
  });

  // ── Null / missing data ─────────────────────────────────────────────────────

  it('returns null for null input', () => {
    expect(parseHopAdvertisement(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(parseHopAdvertisement(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseHopAdvertisement('')).toBeNull();
  });

  // ── Too short ───────────────────────────────────────────────────────────────

  it('returns null when manufacturer data is too short to contain a full tempId', () => {
    // 3 bytes only: UEgB
    expect(parseHopAdvertisement('UEgB')).toBeNull();
  });

  // ── Wrong company ID ────────────────────────────────────────────────────────

  it('returns null when company ID does not match HOP_COMPANY_ID', () => {
    // bytes[0..1] replaced with 0xFF, 0xFF → company ID = 0xFFFF
    // base64: "//8BAQIDBAUGBwgJCgsMDQ4PEA=="
    expect(parseHopAdvertisement('//8BAQIDBAUGBwgJCgsMDQ4PEA==')).toBeNull();
  });

  // ── Wrong protocol version ──────────────────────────────────────────────────

  it('returns null when protocol version does not match HOP_BLE_PROTOCOL_VERSION', () => {
    // bytes[2] changed from 0x01 to 0x02
    // base64: "UEgCAQIDBAUGBwgJCgsMDQ4PEA=="
    expect(parseHopAdvertisement('UEgCAQIDBAUGBwgJCgsMDQ4PEA==')).toBeNull();
  });

  // ── Invalid base64 ─────────────────────────────────────────────────────────

  it('returns null for invalid base64 input', () => {
    expect(parseHopAdvertisement('not-valid-base64!!!')).toBeNull();
  });
});
