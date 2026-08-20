import { Platform } from 'react-native';

export const PASSKEY_NATIVE_REQUIRED_MESSAGE =
  'Passkey recovery needs a HOP build with platform passkeys (Associated Domains + EAS). For now, use a device that still has HOP, an iPhone set up from an encrypted backup of it, or a one-time recovery password if this is a pre-passkey account.';

export function platformPasskeysAvailable(): boolean {
  if (Platform.OS === 'web' && typeof globalThis.PublicKeyCredential === 'function') return true;
  return false;
}

function b64urlToBuffer(value: string): ArrayBuffer {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = globalThis.atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function decodeCredentialDescriptor(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const rec = value as Record<string, unknown>;
  if (typeof rec.id !== 'string') return rec;
  return { ...rec, id: b64urlToBuffer(rec.id) };
}

/** Server JSON uses base64url; WebAuthn credentials.create/get need ArrayBuffers. */
export function publicKeyOptionsFromJson(options: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...options };
  if (typeof next.challenge === 'string') next.challenge = b64urlToBuffer(next.challenge);
  const user = next.user;
  if (user && typeof user === 'object') {
    const rec = user as Record<string, unknown>;
    next.user = typeof rec.id === 'string' ? { ...rec, id: b64urlToBuffer(rec.id) } : rec;
  }
  if (Array.isArray(next.allowCredentials)) {
    next.allowCredentials = next.allowCredentials.map(decodeCredentialDescriptor);
  }
  if (Array.isArray(next.excludeCredentials)) {
    next.excludeCredentials = next.excludeCredentials.map(decodeCredentialDescriptor);
  }
  return next;
}

export async function completePasskeyAssertion(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!platformPasskeysAvailable()) {
    throw new Error(PASSKEY_NATIVE_REQUIRED_MESSAGE);
  }
  const credentials = (globalThis as { navigator?: { credentials?: { get?: Function } } }).navigator?.credentials;
  if (!credentials?.get) {
    throw new Error(PASSKEY_NATIVE_REQUIRED_MESSAGE);
  }
  const credential = await credentials.get({ publicKey: publicKeyOptionsFromJson(options) });
  if (!credential || typeof credential !== 'object') {
    throw new Error('Passkey was cancelled');
  }
  return credentialToJson(credential as PublicKeyCredential);
}

export async function completePasskeyAttestation(
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!platformPasskeysAvailable()) {
    throw new Error(PASSKEY_NATIVE_REQUIRED_MESSAGE);
  }
  const credentials = (globalThis as { navigator?: { credentials?: { create?: Function } } }).navigator?.credentials;
  if (!credentials?.create) {
    throw new Error(PASSKEY_NATIVE_REQUIRED_MESSAGE);
  }
  const credential = await credentials.create({ publicKey: publicKeyOptionsFromJson(options) });
  if (!credential || typeof credential !== 'object') {
    throw new Error('Passkey was cancelled');
  }
  return credentialToJson(credential as PublicKeyCredential);
}

function credentialToJson(credential: PublicKeyCredential): Record<string, unknown> {
  const response = credential.response as AuthenticatorAssertionResponse & AuthenticatorAttestationResponse;
  const json: Record<string, unknown> = {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
    },
  };
  const resp = json.response as Record<string, unknown>;
  if ('authenticatorData' in response && response.authenticatorData) {
    resp.authenticatorData = bufferToBase64url(response.authenticatorData);
  }
  if ('signature' in response && response.signature) {
    resp.signature = bufferToBase64url(response.signature);
  }
  if ('userHandle' in response && response.userHandle) {
    resp.userHandle = bufferToBase64url(response.userHandle);
  }
  if ('attestationObject' in response && response.attestationObject) {
    resp.attestationObject = bufferToBase64url(response.attestationObject);
  }
  return json;
}

function bufferToBase64url(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
