import React, { useState } from 'react';
import {
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { AVATAR_COLORS, useHop } from '@/context/HopContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const { height } = Dimensions.get('window');

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { completeOnboarding } = useHop();
  const [username, setUsername] = useState('');
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[0]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const handleStart = async () => {
    const trimmed = username.trim();
    if (trimmed.length < 2) {
      setError('At least 2 characters');
      return;
    }
    if (trimmed.length > 20) {
      setError('Max 20 characters');
      return;
    }
    if (!/^[a-z0-9_]+$/i.test(trimmed)) {
      setError('Letters, numbers, and underscores only');
      return;
    }
    setError('');
    setLoading(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await completeOnboarding(trimmed.toLowerCase(), selectedColor);
    setLoading(false);
    router.replace('/(tabs)');
  };

  const canSubmit = username.trim().length >= 2;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { minHeight: height, paddingTop: topPad + 40, paddingBottom: bottomPad + 24 }]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Logo */}
      <View style={styles.logoArea}>
        <View style={[styles.logoCircle, { borderColor: colors.primary }]}>
          <Ionicons name="bluetooth" size={44} color={colors.primary} />
        </View>
        <Text style={[styles.logoText, { color: colors.primary }]}>HOP</Text>
        <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
          Bluetooth messaging. No internet needed.
        </Text>
      </View>

      {/* Form */}
      <View style={styles.form}>
        <Text style={[styles.label, { color: colors.foreground }]}>Choose your handle</Text>
        <TextInput
          style={[
            styles.input,
            {
              color: colors.foreground,
              backgroundColor: colors.card,
              borderColor: error ? colors.destructive : colors.border,
            },
          ]}
          placeholder="your_handle"
          placeholderTextColor={colors.mutedForeground}
          value={username}
          onChangeText={v => {
            setUsername(v);
            setError('');
          }}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          returnKeyType="done"
          onSubmitEditing={handleStart}
        />
        {!!error && (
          <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
        )}

        <Text style={[styles.label, { color: colors.foreground, marginTop: 28 }]}>
          Pick your color
        </Text>
        <View style={styles.colorGrid}>
          {AVATAR_COLORS.map(c => (
            <Pressable
              key={c}
              onPress={() => {
                setSelectedColor(c);
                Haptics.selectionAsync();
              }}
              style={[
                styles.colorDot,
                { backgroundColor: c },
                selectedColor === c && {
                  borderWidth: 3,
                  borderColor: colors.primary,
                  transform: [{ scale: 1.18 }],
                },
              ]}
            />
          ))}
        </View>

        {/* Live preview */}
        <View style={[styles.preview, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.previewAvatar, { backgroundColor: selectedColor }]}>
            <Text style={styles.previewInitial}>
              {username.trim() ? username.trim()[0].toUpperCase() : '?'}
            </Text>
          </View>
          <View>
            <Text style={[styles.previewName, { color: colors.foreground }]}>
              {username.trim() || 'your_handle'}
            </Text>
            <Text style={[styles.previewSub, { color: colors.mutedForeground }]}>nearby · discoverable</Text>
          </View>
        </View>
      </View>

      {/* CTA */}
      <Pressable
        onPress={handleStart}
        disabled={!canSubmit || loading}
        style={({ pressed }) => [
          styles.cta,
          {
            backgroundColor: canSubmit ? colors.primary : colors.secondary,
            opacity: pressed ? 0.82 : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.ctaText,
            { color: canSubmit ? colors.primaryForeground : colors.mutedForeground },
          ]}
        >
          {loading ? 'Setting up...' : 'Start Hopping'}
        </Text>
        <Ionicons
          name="arrow-forward"
          size={18}
          color={canSubmit ? colors.primaryForeground : colors.mutedForeground}
        />
      </Pressable>

      <Text style={[styles.note, { color: colors.mutedForeground }]}>
        Visible only to devices nearby
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 28, justifyContent: 'center' },
  logoArea: { alignItems: 'center', marginBottom: 44 },
  logoCircle: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
  },
  logoText: { fontSize: 38, fontFamily: 'Inter_700Bold', letterSpacing: 7 },
  tagline: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 8, textAlign: 'center' },
  form: { marginBottom: 32 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 10, letterSpacing: 0.5 },
  input: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
  },
  error: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 6 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  colorDot: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: 'transparent' },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  previewAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewInitial: { color: '#fff', fontSize: 22, fontWeight: 'bold' as const, fontFamily: 'Inter_700Bold' },
  previewName: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  previewSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 17,
    gap: 10,
    marginBottom: 16,
  },
  ctaText: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  note: { textAlign: 'center', fontSize: 12, fontFamily: 'Inter_400Regular' },
});
