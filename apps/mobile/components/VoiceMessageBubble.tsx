import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Audio } from 'expo-av';

import {
  deleteEphemeralPlaybackFile,
  voiceDataUri,
  writeEphemeralPlaybackFile,
} from '@/src/voice/cache';

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
  const tempUriRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => undefined);
      soundRef.current = null;
      const uri = tempUriRef.current;
      tempUriRef.current = null;
      deleteEphemeralPlaybackFile(uri).catch(() => undefined);
    };
  }, []);

  const stopAndScrubTemp = async () => {
    await soundRef.current?.unloadAsync().catch(() => undefined);
    soundRef.current = null;
    const uri = tempUriRef.current;
    tempUriRef.current = null;
    await deleteEphemeralPlaybackFile(uri);
    setPlaying(false);
    setProgress(0);
  };

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
          uri = await writeEphemeralPlaybackFile(audioB64, mime);
          tempUriRef.current = uri.startsWith('data:') ? null : uri;
        } catch {
          /* data URI fallback — in-memory only, not durable storage */
        }
        const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true }, (st) => {
          if (!st.isLoaded) return;
          const dur = st.durationMillis ?? durationMs;
          setProgress(dur > 0 ? (st.positionMillis ?? 0) / dur : 0);
          if (st.didJustFinish) {
            stopAndScrubTemp().catch(() => undefined);
          }
        });
        soundRef.current = sound;
      } else {
        await soundRef.current.playAsync();
      }
      setPlaying(true);
      setError(null);
    } catch {
      await stopAndScrubTemp();
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
      <View style={[styles.track, { backgroundColor: `${iconColor}33` }]}>
        <View
          style={[
            styles.fill,
            { width: `${Math.max(4, Math.round(progress * 100))}%`, backgroundColor: iconColor },
          ]}
        />
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
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  dur: { fontSize: 12, fontWeight: '600', minWidth: 30 },
});
