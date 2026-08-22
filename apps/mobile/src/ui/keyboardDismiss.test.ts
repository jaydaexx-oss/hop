import { describe, expect, it, vi } from 'vitest';

import {
  contactsUsernameKeyboardProps,
  dismissKeyboardOnOutsideTap,
  keyboardDismissScrollProps,
  shouldDismissKeyboardOnOutsideTap,
} from './keyboardDismiss';

describe('keyboard dismiss on outside tap', () => {
  it('dismisses chrome taps and leaves input/button taps alone', () => {
    expect(shouldDismissKeyboardOnOutsideTap('chrome')).toBe(true);
    expect(shouldDismissKeyboardOnOutsideTap('input')).toBe(false);
    expect(shouldDismissKeyboardOnOutsideTap('button')).toBe(false);
  });

  it('invokes dismiss only for outside chrome', () => {
    const dismiss = vi.fn();
    dismissKeyboardOnOutsideTap(dismiss, 'chrome');
    dismissKeyboardOnOutsideTap(dismiss, 'input');
    dismissKeyboardOnOutsideTap(dismiss, 'button');
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps list buttons tappable while drag dismisses the keyboard', () => {
    expect(keyboardDismissScrollProps.keyboardShouldPersistTaps).toBe('handled');
    expect(keyboardDismissScrollProps.keyboardDismissMode).toBe('on-drag');
  });

  it('lets Contacts Return dismiss without submitting Message', () => {
    expect(contactsUsernameKeyboardProps.returnKeyType).toBe('done');
    expect(contactsUsernameKeyboardProps.blurOnSubmit).toBe(true);
  });
});
