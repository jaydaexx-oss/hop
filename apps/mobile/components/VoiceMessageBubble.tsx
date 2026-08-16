import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Audio } from 'expo-av';

import { cacheVoiceClip, voiceDataUri } from '@/src/voice/cache';

const BARS = [8, 14, 22, 18, 28, 12, 24, 16, 10, 20, 26, 14];

type VoiceMessageBubbleProps = {
  messageId: string;
  audioB64?: string;
  durationMs?: number;
  mime?: string;
  isMe: boolean;
  tint: string;
  tintForeground: string;
  card: string;
  muted: string;
};

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function VoiceMessageBubble({
  messageId,
  audioB64,
  durationMs = 0,
  mime = 'audio/mp4',
  isMe,
  tint,
  tintForeground,
  card,
  muted,
}: VoiceMessageBubbleProps) {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => undefined);
      soundRef.current = null;
    };
  }, []);

  const togglePlay = async () => {
    if (!audioB64) {
      setError('Audio unavailable');
      return;
    }
    if (playing) {
      await soundRef.current?.pauseAsync().catch(() => undefined);
      setPlaying(false);
      return;
    }
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, allowsRecordingIOS: false });
      if (!soundRef.current) {
        let uri = voiceDataUri(audioB64, mime);
        try {
          uri = await cacheVoiceClip(messageId, audioB64, mime);
        } catch {
          /* data URI fallback */
        }
        const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true }, (st) => {
          if (!st.isLoaded) return;
          const dur = st.durationMillis ?? durationMs;
          setProgress(dur > 0 ? (st.positionMillis ?? 0) / dur : 0);
          if (st.didJustFinish) {
            setPlaying(false);
            setProgress(0);
            soundRef.current?.unloadAsync().catch(() => undefined);
            soundRef.current = null;
          }
        });
        soundRef.current = sound;
      } else {
        await soundRef.current.playAsync();
      }
      setPlaying(true);
      setError(null);
    } catch {
      setError('Playback failed');
    }
  };

  const iconColor = isMe ? tintForeground : tint;
  const bubbleBg = isMe ? tint : card;

  return (
    <View style={[styles.bubble, { backgroundColor: bubbleBg }]}>
      <Pressable onPress={togglePlay} style={[styles.playBtn, { backgroundColor: `${iconColor}22` }]}>
        <Text style={[styles.playIcon, { color: iconColor }]}>{playing ? '||' : '>'}</Text>
      </Pressable>
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
      <Text style={[styles.dur, { color: error ? muted : iconColor }]}>
        {error ?? (playing ? fmt(progress * durationMs) : fmt(durationMs))}
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
    maxWidth: '100%',
  },
  playBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIcon: { fontSize: 14, fontWeight: '700' },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  bar: { width: 3, borderRadius: 2 },
  dur: { fontSize: 12, fontWeight: '600', minWidth: 30 },
});
