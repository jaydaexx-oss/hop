/**
 * HOP BLE Service Identity
 * ========================
 * These UUIDs are owned by the HOP project.  They are NOT in the Bluetooth SIG
 * registry and must NOT be changed once devices are shipped — doing so would
 * break discovery with older firmware.
 *
 * Encoding: H=0x48, O=0x4F, P=0x50
 *
 * Service UUID format: 484F5000-484F-5000-8000-000000000001
 *                      ^^^^^^^^                             "HOP\0"
 *                               ^^^^^^^^                   "HOP\0"
 *                                        ^^^^              "5000" — service version 0
 */

// ─── UUIDs ────────────────────────────────────────────────────────────────────

/** Primary GATT service UUID.  Peripheral advertises this so scanners can filter. */
export const HOP_SERVICE_UUID = '484F5000-484F-5000-8000-000000000001';

/**
 * Characteristic: Peer profile ID (readable, notify).
 *
 * Value: UTF-8 encoded profile.id string (UUID format, 36 bytes).
 * This is the stable anonymous device identity, NOT a phone number or real name.
 *
 * A future rotation scheme will wrap this in a signed short-lived token, but
 * for the PoC it is sent in plaintext so the scanner can associate the BLE
 * device with a known HOP user.
 */
export const HOP_PEER_ID_CHAR = '484F5001-484F-5000-8000-000000000001';

/**
 * Characteristic: Protocol version (readable).
 *
 * Value: single uint8 — HOP_BLE_PROTOCOL_VERSION.
 * Scanners MUST reject peers whose version differs by more than the supported
 * delta (currently: must match exactly at v1).
 */
export const HOP_VERSION_CHAR = '484F5002-484F-5000-8000-000000000001';

/**
 * Characteristic: Encrypted message payload (write-without-response, notify).
 *
 * NOT IMPLEMENTED in this PoC — placeholder for the next milestone.
 * Value will be: length-prefixed EncryptedEnvelope protobuf bytes.
 */
export const HOP_MESSAGE_CHAR = '484F5003-484F-5000-8000-000000000001';

// ─── Protocol version ─────────────────────────────────────────────────────────

/** Increment on any breaking change to the characteristic value formats. */
export const HOP_BLE_PROTOCOL_VERSION = 1;

// ─── Timing constants ─────────────────────────────────────────────────────────

/** Maximum duration of a single scan window before restarting. */
export const HOP_SCAN_TIMEOUT_MS = 30_000;

/** Rescan interval — restart scanning this many ms after a scan window ends. */
export const HOP_RESCAN_INTERVAL_MS = 15_000;

/** Remove a peer from the verified set if it has not been re-observed within this window. */
export const HOP_PEER_TTL_MS = 45_000;

/** Maximum ms to wait for characteristic reads during peer verification. */
export const HOP_CONNECT_TIMEOUT_MS = 8_000;

// ─── Company / Manufacturer ID ────────────────────────────────────────────────

/**
 * Manufacturer-specific company ID used in BLE advertisement data.
 *
 * 0x4850 = 'H'(0x48) + 'P'(0x50) — mnemonic for HOP.
 *
 * IMPORTANT: This is NOT a registered Bluetooth SIG company ID.
 * Using an unregistered ID is acceptable for a PoC / development build but
 * MUST be replaced with a registered ID before public release.
 * Registration: https://www.bluetooth.com/specifications/assigned-numbers/
 */
export const HOP_COMPANY_ID = 0x4850;

/**
 * Byte offsets within the manufacturer data buffer returned by
 * react-native-ble-plx's device.manufacturerData (base64-decoded):
 *
 *   [0..1] company ID (uint16 LE) — must equal HOP_COMPANY_ID
 *   [2]    protocol version (uint8) — must equal HOP_BLE_PROTOCOL_VERSION
 *   [3..18] tempId bytes (16 bytes)
 */
export const MFR_OFFSET_COMPANY_ID = 0;
export const MFR_OFFSET_VERSION    = 2;
export const MFR_OFFSET_TEMP_ID    = 3;
export const MFR_TEMP_ID_LENGTH    = 16;
