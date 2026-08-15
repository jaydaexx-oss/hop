import React, { useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { AVATAR_COLORS, useHop } from '@/context/HopContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { profile, setProfile } = useHop();
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(profile?.username ?? '');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 100 : insets.bottom + 60;

  if (!profile) return null;

  const handleColorSelect = async (color: string) => {
    Haptics.selectionAsync();
    await setProfile({ ...profile, color });
  };

  const handleDiscoverableToggle = async (val: boolean) => {
    Haptics.selectionAsync();
    await setProfile({ ...profile, discoverable: val });
  };

  const handleSaveName = async () => {
    const trimmed = nameInput.trim();
    if (trimmed.length < 2) {
      Alert.alert('Too short', 'Handle must be at least 2 characters');
      return;
    }
    await setProfile({ ...profile, username: trimmed });
    setEditing(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingBottom: bottomPad }}
    >
      {/* Hero section */}
      <View style={[styles.hero, { paddingTop: topPad + 20, backgroundColor: colors.background }]}>
        <View style={[styles.bigAvatar, { backgroundColor: profile.color }]}>
          <Text style={styles.bigInitial}>{profile.username[0].toUpperCase()}</Text>
        </View>

        {editing ? (
          <View style={styles.editRow}>
            <TextInput
              style={[
                styles.nameInput,
                {
                  color: colors.foreground,
                  backgroundColor: colors.card,
                  borderColor: colors.primary,
                },
              ]}
              value={nameInput}
              onChangeText={setNameInput}
              autoFocus
              maxLength={20}
              returnKeyType="done"
              onSubmitEditing={handleSaveName}
              autoCapitalize="none"
            />
            <Pressable
              onPress={handleSaveName}
              style={[styles.checkBtn, { backgroundColor: colors.primary }]}
            >
              <Ionicons name="checkmark" size={18} color={colors.primaryForeground} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => {
              setEditing(true);
              setNameInput(profile.username);
            }}
            style={styles.nameRow}
          >
            <Text style={[styles.username, { color: colors.foreground }]}>{profile.username}</Text>
            <Ionicons
              name="pencil-outline"
              size={14}
              color={colors.mutedForeground}
              style={{ marginLeft: 8, marginTop: 3 }}
            />
          </Pressable>
        )}

        <Text style={[styles.deviceId, { color: colors.mutedForeground }]}>
          {profile.id.slice(0, 8).toUpperCase()}
        </Text>
      </View>

      {/* Color picker */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>AVATAR COLOR</Text>
        <View style={styles.colorGrid}>
          {AVATAR_COLORS.map(c => (
            <Pressable
              key={c}
              onPress={() => handleColorSelect(c)}
              style={[
                styles.dot,
                { backgroundColor: c },
                profile.color === c && {
                  borderWidth: 3,
                  borderColor: colors.primary,
                  transform: [{ scale: 1.14 }],
                },
              ]}
            />
          ))}
        </View>
      </View>

      {/* Settings */}
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SETTINGS</Text>

        <View style={[styles.row, { borderBottomColor: colors.border }]}>
          <View style={styles.rowLeft}>
            <Ionicons name="radio-outline" size={20} color={colors.foreground} />
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Discoverable</Text>
          </View>
          <Switch
            value={profile.discoverable}
            onValueChange={handleDiscoverableToggle}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>

        <View style={styles.row}>
          <View style={styles.rowLeft}>
            <Ionicons name="bluetooth-outline" size={20} color={colors.foreground} />
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>Bluetooth</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: colors.primary + '22' }]}>
            <View style={[styles.statusDot, { backgroundColor: colors.primary }]} />
            <Text style={[styles.statusText, { color: colors.primary }]}>Active</Text>
          </View>
        </View>
      </View>

      <Text style={[styles.version, { color: colors.mutedForeground }]}>
        HOP v1.0 · Bluetooth Proximity Messaging
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: { alignItems: 'center', paddingBottom: 28, paddingHorizontal: 20 },
  bigAvatar: {
    width: 92,
    height: 92,
    borderRadius: 46,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  bigInitial: { color: '#fff', fontSize: 38, fontWeight: 'bold' as const, fontFamily: 'Inter_700Bold' },
  nameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  username: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6, width: '80%' },
  nameInput: {
    flex: 1,
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  checkBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deviceId: { fontSize: 11, fontFamily: 'Inter_400Regular', letterSpacing: 1.5 },
  section: {
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 2,
    marginBottom: 14,
  },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 14 },
  dot: { width: 38, height: 38, borderRadius: 19, borderWidth: 2, borderColor: 'transparent' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowLabel: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  version: { textAlign: 'center', fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 8 },
});
