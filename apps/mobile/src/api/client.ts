const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '10.0.2.2', '::1']);

function ipv4Octets(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

export function isLoopbackApiHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/** RFC1918 only. Used so a physical phone can reach the API on the Mac's LAN in __DEV__. */
export function isPrivateLanIpv4(hostname: string): boolean {
  const octets = ipv4Octets(hostname);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function developmentAllowsLanHttp(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function assertSafeApiUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid API URL');
  }
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol !== 'http:') {
    throw new Error('Invalid API URL');
  }
  const host = parsed.hostname.toLowerCase();
  if (isLoopbackApiHost(host)) return;
  if (developmentAllowsLanHttp() && isPrivateLanIpv4(host)) return;
  throw new Error('Refusing cleartext HTTP API URL outside localhost');
}

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8000';
assertSafeApiUrl(API_URL);

/** True when the URL would hit this device, not the Mac running the API. */
export function apiUrlUsesLoopback(url: string = API_URL): boolean {
  try {
    return isLoopbackApiHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

export const LOOPBACK_API_DEVICE_HINT =
  'This API URL is localhost / loopback. It works in the iOS Simulator. On a physical iPhone it is invalid — set EXPO_PUBLIC_API_URL=http://<Mac-LAN-IP>:8000 (same Wi-Fi) or https://<API_DOMAIN>.';

export type HealthResponse = { status: string; service?: string };

export async function getHealth(apiUrl: string = API_URL): Promise<HealthResponse> {
  assertSafeApiUrl(apiUrl);
  const response = await fetch(`${apiUrl}/health`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }
  return (await response.json()) as HealthResponse;
}

export async function postEnvelope(
  envelope: Record<string, unknown>,
  apiUrl: string = API_URL,
): Promise<unknown> {
  assertSafeApiUrl(apiUrl);
  const response = await fetch(`${apiUrl}/messages`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  if (!response.ok) {
    throw new Error(`Submit failed: ${response.status}`);
  }
  return response.json();
}
