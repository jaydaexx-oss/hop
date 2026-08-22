/**
 * Shared composer keyboard math for Broadcast, Chat, and future screens.
 *
 * KeyboardAvoidingView.keyboardVerticalOffset is the gap from the physical
 * screen top to this avoiding view (status bar, nav header, API banner).
 * It is NOT keyboard height — RN already tracks the live keyboard frame, so
 * emoji / predictive-text / multiline changes do not need a pixel fudge.
 */

export const COMPOSER_MIN_BOTTOM_PADDING = 12;

/** iOS uses padding so the column resizes upward. Android typically resizes the window. */
export function composerKeyboardBehavior(os: string): 'padding' | undefined {
  return os === 'ios' ? 'padding' : undefined;
}

/** Header / banner chrome only. Never pass keyboard height here. */
export function composerKeyboardVerticalOffset(viewScreenY: number): number {
  if (!Number.isFinite(viewScreenY) || viewScreenY <= 0) return 0;
  return viewScreenY;
}

/**
 * Bottom padding inside the in-flow composer dock.
 * Keyboard open: small gap (home indicator is behind the keyboard).
 * Tab screens: the tab bar already owns the home indicator when it is visible.
 */
export function composerDockPadding(input: {
  keyboardVisible: boolean;
  safeBottom: number;
  tabBarOwnsSafeArea?: boolean;
  minPadding?: number;
}): number {
  const min = input.minPadding ?? COMPOSER_MIN_BOTTOM_PADDING;
  if (input.keyboardVisible) return min;
  if (input.tabBarOwnsSafeArea) return min;
  return Math.max(min, input.safeBottom);
}

/** Absolute composer chrome sits in the window and will not ride KAV padding. */
export function composerUsesAbsolutePosition(style: { position?: string } | undefined): boolean {
  return style?.position === 'absolute';
}
