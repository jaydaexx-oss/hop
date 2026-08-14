export type NativeDevice = {
  id: string;
  name?: string | null;
  localName?: string | null;
  rssi?: number | null;
  serviceUUIDs?: string[] | null;
};

export type NativeBle = {
  requestBluetoothPermission(): Promise<boolean>;
  isBluetoothEnabled(): Promise<boolean>;
  getCapabilities?: () => Promise<{ peripheralAdvertising?: boolean; advertising?: boolean }>;
  setServices(services: unknown[]): void | Promise<void>;
  startAdvertising(options: { serviceUUIDs: string[]; localName?: string }): void | Promise<void>;
  stopAdvertising(): void | Promise<void>;
  startScan(options?: {
    serviceUUIDs?: string[];
    allowDuplicates?: boolean;
    scanMode?: "lowPower" | "balanced" | "lowLatency";
  }): void | Promise<void>;
  stopScan(): void | Promise<void>;
  connect(deviceId: string): Promise<void>;
  disconnect(deviceId: string): void | Promise<void>;
  discoverServices(deviceId: string): Promise<unknown>;
  requestMTU?: (deviceId: string, mtu: number) => Promise<number>;
  readCharacteristic(
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
  ): Promise<string | { value: string }>;
  writeCharacteristic(
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
    value: string,
    writeType?: "write" | "writeWithoutResponse",
  ): Promise<void>;
  updateCharacteristicValue?(
    serviceUUID: string,
    characteristicUUID: string,
    value: string,
    notify?: boolean,
  ): void | Promise<void>;
  subscribeToCharacteristic(
    deviceId: string,
    serviceUUID: string,
    characteristicUUID: string,
  ): void | Promise<void>;
  addEventListener(event: string, callback: (payload: Record<string, unknown>) => void): unknown;
  addDeviceFoundListener?: (callback: (device: NativeDevice) => void) => unknown;
};

export function unsubscribe(handle: unknown): void {
  if (typeof handle === "function") {
    handle();
    return;
  }
  if (handle && typeof handle === "object" && "remove" in handle && typeof handle.remove === "function") {
    handle.remove();
  }
}
