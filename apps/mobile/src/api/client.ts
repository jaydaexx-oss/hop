import {
  assertSafeApiUrl as assertSafeApiUrlPolicy,
  isLoopbackApiHost,
  isPrivateLanIpv4,
  resolveApiUrl,
} from '@hop/protocol';

function isDevClient(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

function allowStagingCleartext(): boolean {
  return process.env.EXPO_PUBLIC_ALLOW_CLEARTEXT_HTTP === '1';
}

export { isLoopbackApiHost, isPrivateLanIpv4 };

export function assertSafeApiUrl(url: string): void {
  assertSafeApiUrlPolicy(url, {
    isDev: isDevClient(),
    allowCleartextHttp: allowStagingCleartext(),
  });
}

export const API_URL = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, isDevClient());
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
