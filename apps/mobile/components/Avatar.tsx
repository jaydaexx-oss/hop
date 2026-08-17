import { Image, StyleSheet, Text, View } from 'react-native';

type AvatarProps = {
  uri?: string | null;
  color: string;
  username: string;
  size: number;
  borderColor?: string;
  borderWidth?: number;
};

export function avatarInitialsFromName(username: string): string {
  const trimmed = username.trim();
  if (!trimmed || trimmed === 'HOP user') return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function Avatar({ uri, color, username, size, borderColor, borderWidth = 0 }: AvatarProps) {
  const radius = size / 2;
  const base = {
    width: size,
    height: size,
    borderRadius: radius,
    borderWidth,
    borderColor: borderColor ?? 'transparent',
    overflow: 'hidden' as const,
  };

  if (uri) {
    return (
      <View style={[base, { backgroundColor: color }]}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      </View>
    );
  }

  return (
    <View style={[base, { backgroundColor: color, justifyContent: 'center', alignItems: 'center' }]}>
      <Text style={{ color: '#042f2e', fontWeight: '800', fontSize: size * 0.38 }}>
        {avatarInitialsFromName(username)}
      </Text>
    </View>
  );
}
