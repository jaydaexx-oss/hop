/**
 * Jest mock for react-native-ble-plx.
 *
 * Simulates the Expo Go scenario: the JS package is present (the mock
 * resolves), but the native BleClientManager binding is absent, so
 * constructing BleManager throws — exactly as Expo Go behaves at runtime.
 *
 * Registered in jest.context.config.js via moduleNameMapper so that every
 * require('react-native-ble-plx') in the test environment gets this stub.
 */

export class BleManager {
  constructor() {
    throw new Error(
      'NativeModule: BleClientManager is null. ' +
        'To use BLE, run the app in a development build, not Expo Go.',
    );
  }
}

export const State = {
  Unknown: 'Unknown',
  Resetting: 'Resetting',
  Unsupported: 'Unsupported',
  Unauthorized: 'Unauthorized',
  PoweredOff: 'PoweredOff',
  PoweredOn: 'PoweredOn',
} as const;
