import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ERASE_IDENTITY_MESSAGE, RESET_HOP_MESSAGE } from './deviceOnboarding';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readApp(rel: string): string {
  return readFileSync(path.join(root, rel), 'utf8');
}

describe('passwordless consumer auth UI', () => {
  it('does not expose username/password login on the consumer login screen', () => {
    const login = readApp('app/login.tsx');
    expect(login).toContain('Choose a handle and hop in. No password.');
    expect(login).toContain('Start Hopping');
    expect(login).toContain('placeholder="Handle"');
    expect(login).toContain('HANDLE_TAKEN_RECOVER_COPY');
    expect(login).toContain('RECOVER_MY_HOP_LABEL');
    expect(login).toContain('placeholder="One-time recovery password"');
    expect(login).toContain('PASSKEY_NATIVE_REQUIRED_MESSAGE');
    expect(login).toContain('loadPersistedHandleHint');
    expect(login).toContain('formatPreviousHopLabel');
    expect(login).toContain('USE_DIFFERENT_HANDLE_LABEL');
    expect(login).toContain('forgetPersistedHandleHint');
    expect(login).toContain('showingRememberedRecover');
    expect(login).not.toContain('Welcome back');
    expect(login).not.toContain('I already have an account');
    expect(login).not.toMatch(/placeholder=["']Password["']/);
    expect(login).not.toMatch(/placeholder=["']Username["']/);
    expect(login).not.toMatch(/>Log in</);
    expect(login).not.toContain('Device diagnostics');
    expect(login).not.toContain("setMode('password')");
    expect(login).not.toContain('submitPassword');
    expect(login).not.toMatch(/loadPersistedHandleHint[\s\S]{0,500}recoverHop\(/);
    expect(login).toContain('Do not call recoverHop — a handle hint is not authentication.');
  });

  it('replaces Settings logout with session reset plus a separate identity erase', () => {
    const settings = readApp('app/(tabs)/settings.tsx');
    expect(settings).toContain('Reset HOP app');
    expect(settings).toContain('Erase HOP identity from this device');
    expect(settings).toContain('RESET_HOP_TITLE');
    expect(settings).toContain('RESET_HOP_CONFIRM');
    expect(settings).toContain('confirmResetHopApp');
    expect(settings).toContain('confirmEraseIdentity');
    expect(settings).toContain('ERASE_IDENTITY_TITLE_2');
    expect(settings).toContain('eraseThisDeviceIdentity');
    expect(settings).not.toContain('Reset HOP on this device');
    expect(settings).not.toMatch(/Log out/);
    expect(settings).not.toMatch(/\blogout\b/);
    expect(RESET_HOP_MESSAGE).toMatch(/does not mint a new identity/i);
    expect(RESET_HOP_MESSAGE).toMatch(/same account/i);
    expect(RESET_HOP_MESSAGE).toMatch(/not logout that creates a replacement identity/i);
    expect(RESET_HOP_MESSAGE).toMatch(/Blocks and reports stay on the server/i);
    expect(ERASE_IDENTITY_MESSAGE).toMatch(/permanently deletes the HOP keys/i);
    expect(ERASE_IDENTITY_MESSAGE).toMatch(/not a normal reset/i);
    const login = readApp('app/login.tsx');
    expect(login).toContain('Erase HOP identity from this device');
    expect(login).toContain('confirmEraseIdentity');
    expect(login).not.toContain('Reset HOP on this device');
  });

  it('prefills a remembered handle and does not auto-start recovery', () => {
    const login = readApp('app/login.tsx');
    expect(login).toContain('setUsername(handle)');
    expect(login).toContain('formatPreviousHopLabel(rememberedHandle)');
    expect(login).toContain('RECOVER_MY_HOP_LABEL');
    expect(login).toContain('USE_DIFFERENT_HANDLE_LABEL');
    expect(login).toContain('forgetPersistedHandleHint');
    expect(login).toContain('setRecovering(true)');
    const auth = readApp('src/auth/AuthProvider.tsx');
    expect(auth).toContain('handleFromCachedUser');
    expect(auth).toContain('handleHintStore');
    expect(auth).toContain('lastHandle');
    expect(auth).toMatch(/resetAppSession\(identityBackend, \{ store: handleHintStore, lastHandle \}\)/);
    expect(auth).toMatch(/eraseLocalIdentity\(identityBackend, \{ store: handleHintStore, lastHandle \}\)/);
    expect(auth).toContain('restoreExistingSession');
    expect(auth).not.toMatch(/async resetThisDevice\(\)[\s\S]*?registerDeviceIdentity/);
  });

  it('does not list developer tools on Settings even when __DEV__ is true', () => {
    const settings = readApp('app/(tabs)/settings.tsx');
    expect(settings).not.toContain('Replace local identity keys');
    expect(settings).not.toContain('Device diagnostics');
    expect(settings).not.toContain('BLE debug');
    expect(settings).not.toMatch(/buttonLabel[\s\S]*Replace local identity keys/);
    expect(settings).not.toMatch(/buttonLabel[\s\S]*Device diagnostics/);
    expect(settings).not.toMatch(/buttonLabel[\s\S]*BLE debug/);
    const login = readApp('app/login.tsx');
    expect(login).not.toContain('/device-diagnostics');
    expect(login).not.toContain('/ble-debug');
    expect(login).not.toContain('Device diagnostics');
  });
});
