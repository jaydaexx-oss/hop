import React from 'react';
import {
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { Avatar } from '@/components/Avatar';
import type { MyProfile } from '@/context/HopContext';
import * as Haptics from 'expo-haptics';

interface Props {
  profile: MyProfile;
  visible: boolean;
  onClose: () => void;
}

/** Encodes enough info to start a chat even if the scanned user isn't on radar. */
export function buildQRValue(profile: MyProfile): string {
  return `hop://user/${profile.id}/${encodeURIComponent(profile.username)}/${encodeURIComponent(profile.color)}`;
}

/** Parses a hop:// QR payload. Returns null if the string isn't valid. */
export function parseQRValue(raw: string): { id: string; username: string; color: string } | null {
  try {
    if (!raw.startsWith('hop://user/')) return null;
    const parts = raw.slice('hop://user/'.length).split('/');
    if (parts.length < 3) return null;
    const [id, username, color] = parts;
    return { id, username: decodeURIComponent(username), color: decodeURIComponent(color) };
  } catch {
    return null;
  }
}

export function QRCodeModal({ profile, visible, onClose }: Props) {
  const colors = useColors();
  const qrValue = buildQRValue(profile);

  const handleShare = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Share.share({
      message: `Add me on HOP! My username is @${profile.username}\nhop://user/${profile.id}/${encodeURIComponent(profile.username)}/${encodeURIComponent(profile.color)}`,
      title: 'My HOP Code',
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.card }]} onPress={() => {}}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>My HOP Code</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {/* Avatar + username */}
          <View style={styles.identity}>
            <Avatar
              uri={profile.avatarUri}
              color={profile.color}
              username={profile.username}
              size={56}
              borderColor={colors.primary}
              borderWidth={2}
            />
            <View style={{ marginLeft: 14 }}>
              <Text style={[styles.username, { color: colors.foreground }]}>
                @{profile.username}
              </Text>
              <Text style={[styles.subtext, { color: colors.mutedForeground }]}>
                {profile.id.slice(0, 8).toUpperCase()}
              </Text>
            </View>
          </View>

          {/* QR code */}
          <View style={[styles.qrWrap, { backgroundColor: '#fff', borderColor: colors.border }]}>
            <QRCode
              value={qrValue}
              size={200}
              color="#06080F"
              backgroundColor="#ffffff"
              ecl="M"
            />
          </View>

          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Someone nearby can scan this to message you instantly
          </Text>

          {/* Share button */}
          <Pressable
            onPress={handleShare}
            style={[styles.shareBtn, { backgroundColor: colors.primary }]}
          >
            <Ionicons name="share-outline" size={18} color={colors.primaryForeground} />
            <Text style={[styles.shareBtnText, { color: colors.primaryForeground }]}>Share my code</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 20,
  },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 24,
  },
  username: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  subtext: { fontSize: 11, fontFamily: 'Inter_400Regular', letterSpacing: 1.2, marginTop: 2 },
  qrWrap: {
    padding: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 18,
  },
  hint: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 14,
    width: '100%',
    justifyContent: 'center',
  },
  shareBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
});
