import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  composerDockPadding,
  composerKeyboardBehavior,
  composerKeyboardVerticalOffset,
} from '@/src/ui/composerKeyboard';

type Props = {
  children: ReactNode;
  /** In-flow composer. Receives dock padding so the chrome can keep its own background. */
  renderComposer: (paddingBottom: number) => ReactNode;
  /** Tab screens: the tab bar already includes the home indicator when it is visible. */
  tabBarOwnsSafeArea?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * ChatGPT-style composer layout: flex column, composer in document flow,
 * KeyboardAvoidingView padding on iOS. Offset is this view's window Y
 * (header / banner chrome), not a keyboard-height pixel fudge.
 */
export function ComposerKeyboardScreen({
  children,
  renderComposer,
  tabBarOwnsSafeArea = false,
  style,
}: Props) {
  const insets = useSafeAreaInsets();
  const boxRef = useRef<View>(null);
  const [viewScreenY, setViewScreenY] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(() => Keyboard.isVisible());

  const syncOffset = useCallback(() => {
    boxRef.current?.measureInWindow((_x, y) => {
      if (typeof y === 'number' && Number.isFinite(y)) {
        setViewScreenY((prev) => (Math.abs(prev - y) < 0.5 ? prev : y));
      }
    });
  }, []);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, () => {
      setKeyboardVisible(true);
      syncOffset();
    });
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [syncOffset]);

  const paddingBottom = composerDockPadding({
    keyboardVisible,
    safeBottom: insets.bottom,
    tabBarOwnsSafeArea,
  });

  return (
    <View ref={boxRef} onLayout={syncOffset} style={[styles.fill, style]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={composerKeyboardBehavior(Platform.OS)}
        keyboardVerticalOffset={composerKeyboardVerticalOffset(viewScreenY)}>
        <View style={styles.fill}>{children}</View>
        {renderComposer(paddingBottom)}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
