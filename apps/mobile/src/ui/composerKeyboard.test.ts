import { describe, expect, it } from 'vitest';

import {
  COMPOSER_MIN_BOTTOM_PADDING,
  composerDockPadding,
  composerKeyboardBehavior,
  composerKeyboardVerticalOffset,
  composerUsesAbsolutePosition,
} from './composerKeyboard';

describe('composer keyboard chrome', () => {
  it('uses padding avoidance on iOS and lets Android resize the window', () => {
    expect(composerKeyboardBehavior('ios')).toBe('padding');
    expect(composerKeyboardBehavior('android')).toBeUndefined();
    expect(composerKeyboardBehavior('web')).toBeUndefined();
  });

  it('takes keyboardVerticalOffset from view chrome, never keyboard height', () => {
    expect(composerKeyboardVerticalOffset(96)).toBe(96);
    expect(composerKeyboardVerticalOffset(0)).toBe(0);
    expect(composerKeyboardVerticalOffset(-12)).toBe(0);
    expect(composerKeyboardVerticalOffset(Number.NaN)).toBe(0);
    const keyboardHeight = 336;
    expect(composerKeyboardVerticalOffset(47)).not.toBe(keyboardHeight);
    expect(composerKeyboardVerticalOffset(47)).toBe(47);
  });

  it('drops the home-indicator inset while the keyboard is open', () => {
    expect(
      composerDockPadding({
        keyboardVisible: true,
        safeBottom: 34,
        tabBarOwnsSafeArea: false,
      }),
    ).toBe(COMPOSER_MIN_BOTTOM_PADDING);
    expect(
      composerDockPadding({
        keyboardVisible: false,
        safeBottom: 34,
        tabBarOwnsSafeArea: false,
      }),
    ).toBe(34);
  });

  it('does not double-count a tab bar safe area when the keyboard is closed', () => {
    expect(
      composerDockPadding({
        keyboardVisible: false,
        safeBottom: 34,
        tabBarOwnsSafeArea: true,
      }),
    ).toBe(COMPOSER_MIN_BOTTOM_PADDING);
  });

  it('rejects absolute composer chrome that would pin behind the keyboard', () => {
    expect(composerUsesAbsolutePosition({ position: 'absolute' })).toBe(true);
    expect(composerUsesAbsolutePosition({ position: 'relative' })).toBe(false);
    expect(composerUsesAbsolutePosition(undefined)).toBe(false);
  });
});
