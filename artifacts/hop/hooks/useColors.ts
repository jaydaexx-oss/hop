/**
 * Returns the design tokens for the current color scheme.
 *
 * BUG FIX (bug 4): HOP is dark-first. On web, useColorScheme() returns null,
 * which previously caused the hook to fall back to the light palette (blue on
 * white). The fix defaults to 'dark' when the OS reports null, so the electric
 * cyan / deep navy design is shown correctly on all platforms on first render.
 */
import { Appearance, useColorScheme } from 'react-native';
import colors from '@/constants/colors';

// Force dark mode as the default for the HOP app on platforms that don't
// report a system preference (web). This call is safe to make at module
// load time — it only sets the in-app default, it does not change the OS.
if (Appearance.getColorScheme() === null) {
  Appearance.setColorScheme('dark');
}

export function useColors() {
  const scheme = useColorScheme() ?? 'dark'; // bug 4 fix: default dark
  const palette =
    scheme === 'dark' && 'dark' in colors
      ? (colors as Record<string, typeof colors.light>).dark
      : colors.light;
  return { ...palette, radius: colors.radius };
}
