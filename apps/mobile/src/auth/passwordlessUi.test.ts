import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { RESET_HOP_MESSAGE } from './deviceOnboarding';

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
    expect(login).not.toContain('Welcome back');
    expect(login).not.toContain('I already have an account');
    expect(login).not.toMatch(/placeholder=["']Password["']/);
    expect(login).not.toMatch(/placeholder=["']Username["']/);
    expect(login).not.toMatch(/>Log in</);
    expect(login).not.toContain('Device diagnostics');
    expect(login).not.toContain("setMode('password')");
    expect(login).not.toContain('submitPassword');
  });

  it('replaces Settings logout with a confirmed local reset', () => {
    const settings = readApp('app/(tabs)/settings.tsx');
    expect(settings).toContain('Reset HOP on this device');
    expect(settings).toContain('RESET_HOP_TITLE');
    expect(settings).toContain('RESET_HOP_CONFIRM');
    expect(settings).toContain('confirmResetHop');
    expect(settings).not.toMatch(/Log out/);
    expect(settings).not.toMatch(/\blogout\b/);
    expect(RESET_HOP_MESSAGE).toMatch(/THIS phone only/i);
    expect(RESET_HOP_MESSAGE).toMatch(/stay on the server/i);
    expect(RESET_HOP_MESSAGE).toMatch(/cannot take your current handle/i);
  });

  it('keeps device diagnostics behind the existing DEV Settings path', () => {
    const settings = readApp('app/(tabs)/settings.tsx');
    expect(settings).toMatch(/\{__DEV__ \? \([\s\S]*Device diagnostics/);
    const login = readApp('app/login.tsx');
    expect(login).not.toContain('/device-diagnostics');
  });
});
