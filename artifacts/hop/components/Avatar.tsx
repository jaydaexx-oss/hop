/**
 * Shared Avatar component.
 * Shows a photo when `uri` is provided, otherwise falls back to the
 * color circle + initial that the app has always used.
 */
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

interface AvatarProps {
  uri?: string | null;
  color: string;
  username: string;
  size: number;
  borderColor?: string;
  borderWidth?: number;
}

export function Avatar({ uri, color, username, size, borderColor, borderWidth = 0 }: AvatarProps) {
  const r = size / 2;
  const base = {
    width: size,
    height: size,
    borderRadius: r,
    borderWidth,
    borderColor: borderColor ?? 'transparent',
    overflow: 'hidden' as const,
  };

  if (uri) {
    return (
      <View style={[base, { backgroundColor: color }]}>
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      </View>
    );
  }

  return (
    <View style={[base, { backgroundColor: color, justifyContent: 'center', alignItems: 'center' }]}>
      <Text
        style={{
          color: '#fff',
          fontFamily: 'Inter_700Bold',
          fontSize: size * 0.42,
          lineHeight: size * 0.52,
        }}
      >
        {(username[0] ?? '?').toUpperCase()}
      </Text>
    </View>
  );
}
