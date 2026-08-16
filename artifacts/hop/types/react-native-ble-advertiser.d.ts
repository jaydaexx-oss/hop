/**
 * Type declarations for react-native-ble-advertiser.
 * Hand-written — the package ships no bundled types.
 * Covers only the subset of the API used by HOP.
 */
declare module 'react-native-ble-advertiser' {
  interface BroadcastOptions {
    /** Android: scan/advertise duty cycle */
    advertiseMode?: number;
    /** Android: transmit power */
    txPowerLevel?: number;
    /** Whether the advertisement is connectable */
    connectable?: boolean;
    /** Include the device's Bluetooth name in the advertisement.
     *  Always set to false — HOP must not leak device names. */
    includeDeviceName?: boolean;
    /** Include TX power level in the advertisement */
    includeTxPowerLevel?: boolean;
  }

  const BLEAdvertiser: {
    // ── Android advertise-mode constants ────────────────────────────────
    ADVERTISE_MODE_LOW_POWER: number;
    ADVERTISE_MODE_BALANCED: number;
    ADVERTISE_MODE_LOW_LATENCY: number;

    // ── Android TX power constants ───────────────────────────────────────
    ADVERTISE_TX_POWER_ULTRA_LOW: number;
    ADVERTISE_TX_POWER_LOW: number;
    ADVERTISE_TX_POWER_MEDIUM: number;
    ADVERTISE_TX_POWER_HIGH: number;

    /**
     * Set the company/manufacturer ID included in manufacturer-specific
     * advertisement data.  Call once before broadcast().
     * Android only — on iOS, the library uses CBPeripheralManager directly.
     */
    setCompanyId(id: number): void;

    /**
     * Start advertising the given service UUID.
     *
     * @param serviceUUID  128-bit UUID string to advertise.
     * @param payload      Manufacturer-specific payload bytes (AFTER the 2-byte
     *                     company ID that the library prepends automatically).
     * @param options      Platform-specific advertising options.
     */
    broadcast(
      serviceUUID: string,
      payload: number[],
      options?: BroadcastOptions,
    ): Promise<void>;

    /** Stop advertising. */
    stopBroadcast(): Promise<void>;

    /**
     * Returns true when this device supports BLE peripheral mode.
     * Not all Android devices support advertising.
     */
    supportPeripheral(): Promise<boolean>;
  };

  export default BLEAdvertiser;
}
