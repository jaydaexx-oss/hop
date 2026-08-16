/**
 * BLE permissions — iOS and Android native implementation.
 *
 * iOS:
 *   BLE permission is granted via NSBluetoothAlwaysUsageDescription in Info.plist.
 *   The system shows the dialog automatically on first BLE API use.
 *   No runtime requestPermission() call is needed in React Native code.
 *   This function returns 'granted' on iOS — the real gate is CBCentralManager.state.
 *
 * Android API 31+ (Android 12+):
 *   Requires: BLUETOOTH_SCAN, BLUETOOTH_CONNECT, BLUETOOTH_ADVERTISE
 *   These are normal permissions that must be requested at runtime.
 *
 * Android API 30 and below (Android 11 and below):
 *   Requires: ACCESS_FINE_LOCATION (BLE scan results are considered location data),
 *             BLUETOOTH, BLUETOOTH_ADMIN (declared in AndroidManifest, not runtime).
 *
 * app.json declares all required permissions in the android.permissions array.
 * See docs/BLE_IMPLEMENTATION.md for the full permission setup guide.
 */

import { Platform, PermissionsAndroid } from 'react-native';

export type BlePermissionStatus = 'granted' | 'denied' | 'unavailable' | 'unsupported';

export async function requestBlePermissions(): Promise<BlePermissionStatus> {
  // iOS: no runtime request needed — CBCentralManager handles it.
  if (Platform.OS === 'ios') {
    return 'granted';
  }

  if (Platform.OS === 'android') {
    const apiLevel = parseInt(String(Platform.Version), 10);

    if (apiLevel >= 31) {
      // Android 12+ — new BLUETOOTH_* permissions
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
      ]);

      const allGranted = Object.values(results).every(
        r => r === PermissionsAndroid.RESULTS.GRANTED,
      );
      return allGranted ? 'granted' : 'denied';
    } else {
      // Android 11 and below — location permission gates BLE scan results
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location permission required',
          message:
            'HOP needs location permission to scan for nearby Bluetooth devices. ' +
            'No location data is collected or stored.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        },
      );
      return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
    }
  }

  return 'unavailable';
}
