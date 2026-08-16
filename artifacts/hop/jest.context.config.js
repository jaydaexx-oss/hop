/**
 * Jest config for tests that mount React Native components / context providers.
 *
 * Uses the jest-expo preset so babel-jest transforms react-native packages
 * correctly (the default ts-jest config runs in a plain node environment that
 * cannot parse react-native's Flow-typed source).
 *
 * The only override: react-native/setup-env is mapped to a local stub because
 * @react-native/jest-preset 0.87.0 points to src/setup-env.js which doesn't
 * exist in react-native 0.81.5.
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/hop-context*.test.[jt]s?(x)'],
  moduleNameMapper: {
    '^react-native/setup-env$':
      '<rootDir>/__mocks__/react-native-setup-env-stub.js',
    // Map react-native-ble-plx to a controlled mock that simulates the Expo Go
    // runtime: the JS package resolves but BleManager construction throws.
    '^react-native-ble-plx$':
      '<rootDir>/__mocks__/react-native-ble-plx.ts',
    // Stub react-native-ble-advertiser (used by HopBleAdvertiser.native.ts).
    '^react-native-ble-advertiser$':
      '<rootDir>/__mocks__/react-native-ble-advertiser.ts',
    // Force the web stubs for BLE hooks so native hooks (and their transitive
    // deps on react-native-ble-plx / react-native-ble-advertiser) are never
    // loaded in HopContext tests.  Tests that want to exercise a native hook
    // should import it directly via a relative path, bypassing this mapper.
    '^@/hooks/useBluetoothDiscovery(\\.native)?$':
      '<rootDir>/hooks/useBluetoothDiscovery.ts',
    '^@/hooks/useBluetoothAdvertising(\\.native)?$':
      '<rootDir>/hooks/useBluetoothAdvertising.ts',
    // Stub the native BLE advertiser class so the web stub for
    // useBluetoothAdvertising can import it without hitting native code.
    '^@/protocol/ble/HopBleAdvertiser(\\.native)?$':
      '<rootDir>/protocol/ble/HopBleAdvertiser.ts',
    '^@/(.*)$': '<rootDir>/$1',
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/__mocks__/@react-native-async-storage/async-storage.ts',
  },
};
