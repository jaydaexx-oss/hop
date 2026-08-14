const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '10.0.2.2', '::1']);

export function assertSafeApiUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid API URL');
  }
  if (parsed.protocol === 'http:' && !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error('Refusing cleartext HTTP API URL outside localhost');
  }
}

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8000';
assertSafeApiUrl(API_URL);

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
