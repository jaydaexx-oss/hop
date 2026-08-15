import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

/** Web fallback — expo-camera barcode scanning is native-only. */
export default function ScanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={[styles.closeBtn, { backgroundColor: colors.card }]}>
          <Ionicons name="close" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.topTitle, { color: colors.foreground }]}>Scan HOP Code</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.body}>
        <Ionicons name="camera-outline" size={64} color={colors.mutedForeground} />
        <Text style={[styles.title, { color: colors.foreground }]}>Camera not available</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          QR scanning works on iOS and Android.{'\n'}Open HOP in the Expo Go app to scan codes.
        </Text>
        <Pressable onPress={() => router.back()} style={[styles.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.backBtnText, { color: colors.foreground }]}>Go back</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },
  topTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  body: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 14,
  },
  title: { fontSize: 20, fontFamily: 'Inter_700Bold', textAlign: 'center' },
  sub: {
    fontSize: 15, fontFamily: 'Inter_400Regular',
    textAlign: 'center', lineHeight: 22,
  },
  backBtn: {
    marginTop: 8,
    paddingHorizontal: 28, paddingVertical: 13,
    borderRadius: 14, borderWidth: StyleSheet.hairlineWidth,
  },
  backBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
