import { Platform } from 'react-native';
import Constants from 'expo-constants';

import type { NativeBle } from './nativeTypes';

export function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

export function bleRuntimeBlockedReason(): string | null {
  if (Platform.OS === 'web') {
    return 'Nearby BLE does not run on web. Use a physical iPhone or Android phone.';
  }
  if (isExpoGo()) {
    return 'Nearby BLE cannot run in Expo Go. Install a HOP development build on a physical device.';
  }
  return null;
}

function characteristicHex(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'value' in result && typeof result.value === 'string') {
    return result.value;
  }
  return '';
}

export async function loadNativeBle(): Promise<NativeBle | null> {
  if (bleRuntimeBlockedReason()) return null;
  try {
    const mod = await import('munim-bluetooth');
    if (typeof mod.requestBluetoothPermission !== 'function') return null;
    const wrapped: NativeBle = {
      requestBluetoothPermission: () => mod.requestBluetoothPermission(['scan', 'connect', 'advertise']),
      isBluetoothEnabled: () => mod.isBluetoothEnabled(),
      getCapabilities: async () => {
        const caps = await mod.getCapabilities();
        return { peripheralAdvertising: caps.supportsBlePeripheral, advertising: caps.supportsBlePeripheral };
      },
      setServices: (services) => mod.setServices(services as never),
      startAdvertising: (options) => mod.startAdvertising(options),
      stopAdvertising: () => mod.stopAdvertising(),
      startScan: (options) => mod.startScan(options),
      stopScan: () => mod.stopScan(),
      connect: (deviceId) => mod.connect(deviceId),
      disconnect: async (deviceId) => {
        mod.disconnect(deviceId);
      },
      discoverServices: (deviceId) => mod.discoverServices(deviceId),
      requestMTU: (deviceId, mtu) => mod.requestMTU(deviceId, mtu),
      readCharacteristic: async (deviceId, serviceUUID, characteristicUUID) =>
        characteristicHex(await mod.readCharacteristic(deviceId, serviceUUID, characteristicUUID)),
      writeCharacteristic: (deviceId, serviceUUID, characteristicUUID, value, writeType) =>
        mod.writeCharacteristic(deviceId, serviceUUID, characteristicUUID, value, writeType),
      subscribeToCharacteristic: (deviceId, serviceUUID, characteristicUUID) =>
        mod.subscribeToCharacteristic(deviceId, serviceUUID, characteristicUUID),
      updateCharacteristicValue: (serviceUUID, characteristicUUID, value, notify) =>
        mod.updateCharacteristicValue(serviceUUID, characteristicUUID, value, notify),
      addEventListener: (event, callback) =>
        mod.addEventListener(event as never, callback as never),
      addDeviceFoundListener: (callback) => mod.addDeviceFoundListener(callback),
    };
    return wrapped;
  } catch {
    return null;
  }
}
