import { createBluetoothTransport } from "./bluetoothTransport.js";
import type { HopHttpClient } from "./http.js";
import { createInternetTransport } from "./internetTransport.js";
import { LocalTransport } from "./localTransport.js";
import type { TransportId } from "./transport.js";
import { TransportManager } from "./transportManager.js";

/** App send path only. Relay and SimulatedNetwork are never registered here. */
export const PRODUCTION_APP_TRANSPORT_IDS: readonly TransportId[] = ["internet", "bluetooth", "local"];

export const FORBIDDEN_PRODUCTION_TRANSPORT_IDS: readonly TransportId[] = ["relay"];

/**
 * Same registration order as the mobile app (`createAppTransportManager`).
 * BLE starts unimplemented until BleProvider re-registers a native link.
 * LocalTransport is the in-process last-resort adapter, not a mock network.
 */
export function createProductionAppTransportManager(http: HopHttpClient): TransportManager {
  const manager = new TransportManager();
  manager.register(createInternetTransport(http));
  manager.register(createBluetoothTransport());
  manager.register(new LocalTransport());
  return manager;
}

export function assertProductionTransportSet(ids: readonly TransportId[]): void {
  if (ids.some((id) => FORBIDDEN_PRODUCTION_TRANSPORT_IDS.includes(id))) {
    throw new Error("Production send path must not register relay");
  }
  if (ids.length !== PRODUCTION_APP_TRANSPORT_IDS.length) {
    throw new Error("Production send path transport set is unexpected");
  }
  for (const expected of PRODUCTION_APP_TRANSPORT_IDS) {
    if (!ids.includes(expected)) {
      throw new Error(`Production send path missing transport ${expected}`);
    }
  }
}
