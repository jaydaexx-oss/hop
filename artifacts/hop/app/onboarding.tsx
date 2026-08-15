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
import * as ImagePicker from 'expo-image-picker';
import { useColors } from '@/hooks/useColors';
import { AVATAR_COLORS, useHop } from '@/context/HopContext';
import { Avatar } from '@/components/Avatar';
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
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setAvatarUri(result.assets[0].uri);
    }
  };

  const handleStart = async () => {
    const trimmed = username.trim();
    if (trimmed.length < 2) { setError('At least 2 characters'); return; }
    if (trimmed.length > 20) { setError('Max 20 characters'); return; }
    if (!/^[a-z0-9_]+$/i.test(trimmed)) { setError('Letters, numbers, and underscores only'); return; }
    setError('');
    setLoading(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await completeOnboarding(trimmed.toLowerCase(), selectedColor, avatarUri ?? undefined);
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

      <View style={styles.form}>
        {/* Handle */}
        <Text style={[styles.label, { color: colors.foreground }]}>Choose your handle</Text>
        <TextInput
          style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: error ? colors.destructive : colors.border }]}
          placeholder="your_handle"
          placeholderTextColor={colors.mutedForeground}
          value={username}
          onChangeText={v => { setUsername(v); setError(''); }}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          returnKeyType="done"
          onSubmitEditing={handleStart}
        />
        {!!error && <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>}

        {/* Photo + color row */}
        <Text style={[styles.label, { color: colors.foreground, marginTop: 28 }]}>
          Profile picture
        </Text>

        {/* Tappable avatar preview */}
        <Pressable onPress={pickPhoto} style={styles.avatarPicker}>
          <Avatar
            uri={avatarUri}
            color={selectedColor}
            username={username.trim() || '?'}
            size={72}
            borderColor={colors.primary}
            borderWidth={2}
          />
          {/* Camera badge */}
          <View style={[styles.cameraBadge, { backgroundColor: colors.primary }]}>
            <Ionicons name="camera" size={13} color={colors.primaryForeground} />
          </View>
          <Text style={[styles.photoHint, { color: colors.mutedForeground }]}>
            {avatarUri ? 'Tap to change' : 'Tap to add photo'}
          </Text>
        </Pressable>

        {/* Remove photo */}
        {avatarUri && (
          <Pressable onPress={() => setAvatarUri(null)} style={styles.removePhoto}>
            <Text style={[styles.removePhotoText, { color: colors.destructive }]}>Remove photo</Text>
          </Pressable>
        )}

        {/* Color fallback label */}
        <Text style={[styles.label, { color: colors.foreground, marginTop: 20 }]}>
          {avatarUri ? 'Accent color (backup)' : 'Or pick a color'}
        </Text>
        <View style={styles.colorGrid}>
          {AVATAR_COLORS.map(c => (
            <Pressable
              key={c}
              onPress={() => { setSelectedColor(c); Haptics.selectionAsync(); }}
              style={[
                styles.colorDot,
                { backgroundColor: c },
                selectedColor === c && { borderWidth: 3, borderColor: colors.primary, transform: [{ scale: 1.18 }] },
              ]}
            />
          ))}
        </View>

        {/* Live preview */}
        <View style={[styles.preview, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Avatar
            uri={avatarUri}
            color={selectedColor}
            username={username.trim() || '?'}
            size={52}
          />
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
        style={({ pressed }) => [styles.cta, { backgroundColor: canSubmit ? colors.primary : colors.secondary, opacity: pressed ? 0.82 : 1 }]}
      >
        <Text style={[styles.ctaText, { color: canSubmit ? colors.primaryForeground : colors.mutedForeground }]}>
          {loading ? 'Setting up...' : 'Start Hopping'}
        </Text>
        <Ionicons name="arrow-forward" size={18} color={canSubmit ? colors.primaryForeground : colors.mutedForeground} />
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
  logoCircle: { width: 92, height: 92, borderRadius: 46, borderWidth: 2, justifyContent: 'center', alignItems: 'center', marginBottom: 18 },
  logoText: { fontSize: 38, fontFamily: 'Inter_700Bold', letterSpacing: 7 },
  tagline: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 8, textAlign: 'center' },
  form: { marginBottom: 32 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginBottom: 10, letterSpacing: 0.5 },
  input: { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, fontFamily: 'Inter_500Medium' },
  error: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 6 },
  avatarPicker: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 6 },
  cameraBadge: {
    width: 26, height: 26, borderRadius: 13,
    justifyContent: 'center', alignItems: 'center',
    marginLeft: -20, marginBottom: -48, zIndex: 2,
  },
  photoHint: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  removePhoto: { marginBottom: 4 },
  removePhotoText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  colorDot: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: 'transparent' },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 14, padding: 14, borderWidth: 1 },
  previewName: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  previewSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 16, paddingVertical: 17, gap: 10, marginBottom: 16 },
  ctaText: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  note: { textAlign: 'center', fontSize: 12, fontFamily: 'Inter_400Regular' },
});
