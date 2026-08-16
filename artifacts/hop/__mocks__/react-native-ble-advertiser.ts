/**
 * Jest mock for react-native-ble-advertiser.
 *
 * Simulates the Expo Go / unsupported-platform scenario: all advertising
 * operations are no-ops and the module resolves without crashing.
 */

const BLEAdvertiser = {
  setCompanyId: jest.fn(),
  broadcast: jest.fn().mockResolvedValue(undefined),
  stopBroadcast: jest.fn().mockResolvedValue(undefined),
  supportPeripheral: jest.fn().mockResolvedValue(false),
};

export default BLEAdvertiser;
