/**
 * Keyboard dismiss policy for Contacts, Broadcast, and Chat.
 *
 * Do not wrap a whole screen in TouchableWithoutFeedback + Keyboard.dismiss —
 * that steals button presses. Use scroll props on lists and Pressable only on
 * non-interactive chrome (title, empty padding).
 */

export const keyboardDismissScrollProps = {
  keyboardShouldPersistTaps: 'handled',
  keyboardDismissMode: 'on-drag',
} as const;

/** Contacts username: Return/Done dismisses. Message stays a separate button. */
export const contactsUsernameKeyboardProps = {
  returnKeyType: 'done',
  blurOnSubmit: true,
} as const;

export type KeyboardTapTarget = 'chrome' | 'input' | 'button';

/** True for titles, gutters, empty padding. False for TextInput and buttons. */
export function shouldDismissKeyboardOnOutsideTap(target: KeyboardTapTarget): boolean {
  return target === 'chrome';
}

/** Call from Pressable chrome. Screens pass Keyboard.dismiss. */
export function dismissKeyboardOnOutsideTap(
  dismiss: () => void,
  target: KeyboardTapTarget = 'chrome',
): void {
  if (shouldDismissKeyboardOnOutsideTap(target)) dismiss();
}
