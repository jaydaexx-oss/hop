import { API_URL, assertSafeApiUrl } from './api/client';
import {
  LocalTransport,
  TransportManager,
  createBluetoothTransport,
  createInternetTransport,
  type HopHttpClient,
} from '@hop/protocol';

export function createHopHttp(getToken?: () => string | null): HopHttpClient {
  return {
    async request(path, init) {
      assertSafeApiUrl(API_URL);
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      };
      const token = getToken?.();
      if (token && !headers.Authorization) {
        headers.Authorization = `Bearer ${token}`;
      }
      try {
        const response = await fetch(`${API_URL}${path}`, {
          method: init?.method ?? 'GET',
          headers,
          body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        });
        let data: unknown = null;
        try {
          data = await response.json();
        } catch {
          data = null;
        }
        return { ok: response.ok, status: response.status, data };
      } catch {
        return { ok: false, status: 0, data: null };
      }
    },
  };
}

/**
 * App send path: TransportManager only (internet, then BLE).
 * Relay/SimulatedNetwork are not registered here. Durable queue is MessageService + SQLite.
 */
export function createAppTransportManager(http: HopHttpClient): TransportManager {
  const manager = new TransportManager();
  manager.register(createInternetTransport(http));
  manager.register(createBluetoothTransport());
  manager.register(new LocalTransport());
  return manager;
}
