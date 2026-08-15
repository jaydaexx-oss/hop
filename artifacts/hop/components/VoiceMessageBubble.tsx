/**
 * VoiceMessageBubble — renders a recorded voice message inside a chat bubble.
 *
 * Shows a play/pause button, a decorative waveform that partially fills as
 * playback progresses, and the formatted duration.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';

// Static bar heights (decorative; non-uniform for realism)
const BARS = [8, 14, 22, 18, 28, 12, 24, 16, 10, 20, 26, 14];

interface VoiceMessageBubbleProps {
  uri?: string;
  durationMs?: number;
  isMe: boolean;
  primaryColor: string;
  primaryForegroundColor: string;
  foregroundColor: string;
  cardColor: string;
  borderColor: string;
}

export function VoiceMessageBubble({
  uri,
  durationMs = 0,
  isMe,
  primaryColor,
  primaryForegroundColor,
  foregroundColor,
  cardColor,
  borderColor,
}: VoiceMessageBubbleProps) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0–1
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const togglePlay = async () => {
    if (!uri) return;

    if (playing) {
      await soundRef.current?.pauseAsync().catch(() => {});
      setPlaying(false);
      return;
    }

    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });

      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: true },
          (st) => {
            if (!st.isLoaded) return;
            const dur = st.durationMillis ?? durationMs;
            setProgress(dur > 0 ? (st.positionMillis ?? 0) / dur : 0);
            if (st.didJustFinish) {
              setPlaying(false);
              setProgress(0);
              soundRef.current?.unloadAsync().catch(() => {});
              soundRef.current = null;
            }
          },
        );
        soundRef.current = sound;
      } else {
        await soundRef.current.playAsync();
      }
      setPlaying(true);
    } catch (err) {
      console.warn('VoiceMessage playback error:', err);
    }
  };

  const fmt = (ms: number) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const iconColor = isMe ? primaryForegroundColor : primaryColor;
  const bubbleBg  = isMe ? primaryColor : cardColor;
  const bubbleBorder = isMe ? {} : { borderWidth: StyleSheet.hairlineWidth, borderColor };

  return (
    <View style={[styles.bubble, { backgroundColor: bubbleBg }, bubbleBorder]}>
      {/* Play / Pause */}
      <Pressable onPress={togglePlay} style={[styles.playBtn, { backgroundColor: `${iconColor}22` }]}>
        <Ionicons name={playing ? 'pause' : 'play'} size={18} color={iconColor} />
      </Pressable>

      {/* Waveform */}
      <View style={styles.waveRow}>
        {BARS.map((h, i) => {
          const filled = progress > 0 && i / BARS.length < progress;
          return (
            <View
              key={i}
              style={[
                styles.bar,
                { height: h, backgroundColor: iconColor, opacity: filled ? 1 : 0.3 },
              ]}
            />
          );
        })}
      </View>

      {/* Duration */}
      <Text style={[styles.dur, { color: iconColor }]}>
        {playing ? fmt(progress * durationMs) : fmt(durationMs)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 18,
    gap: 8,
    maxWidth: '74%',
  },
  playBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  bar:     { width: 3, borderRadius: 2 },
  dur:     { fontSize: 12, fontFamily: 'Inter_600SemiBold', minWidth: 30 },
});
