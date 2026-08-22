import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';

import {
  deleteEphemeralPlaybackFile,
  voiceDataUri,
  writeEphemeralPlaybackFile,
} from '@/src/voice/cache';
import { claimVoicePlayback, releaseVoicePlayback } from '@/src/voice/playback';

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
  const soundRef = useRef<AudioPlayer | null>(null);
  const statusSubRef = useRef<{ remove(): void } | null>(null);
  const tempUriRef = useRef<string | null>(null);

  const releasePlayer = () => {
    statusSubRef.current?.remove();
    statusSubRef.current = null;
    soundRef.current?.remove();
    soundRef.current = null;
  };

  const stopAndScrubTemp = async () => {
    releasePlayer();
    const uri = tempUriRef.current;
    tempUriRef.current = null;
    await deleteEphemeralPlaybackFile(uri);
    releaseVoicePlayback(messageId);
    setPlaying(false);
    setProgress(0);
  };

  useEffect(() => {
    return () => {
      releasePlayer();
      const uri = tempUriRef.current;
      tempUriRef.current = null;
      deleteEphemeralPlaybackFile(uri).catch(() => undefined);
      releaseVoicePlayback(messageId);
    };
  }, [messageId]);

  const togglePlay = async () => {
    if (!audioB64) {
      setError('Audio unavailable');
      return;
    }
    if (playing) {
      soundRef.current?.pause();
      setPlaying(false);
      return;
    }
    try {
      claimVoicePlayback(messageId, () => {
        void stopAndScrubTemp();
      });
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      if (!soundRef.current) {
        let uri = voiceDataUri(audioB64, mime);
        try {
          uri = await writeEphemeralPlaybackFile(audioB64, mime);
          tempUriRef.current = uri.startsWith('data:') ? null : uri;
        } catch {
          /* data URI fallback — in-memory only, not durable storage */
        }
        const player = createAudioPlayer({ uri }, { updateInterval: 100 });
        statusSubRef.current = player.addListener('playbackStatusUpdate', (st: AudioStatus) => {
          if (!st.isLoaded) return;
          const durMs = st.duration > 0 ? st.duration * 1000 : durationMs;
          setProgress(durMs > 0 ? (st.currentTime * 1000) / durMs : 0);
          if (st.didJustFinish) {
            stopAndScrubTemp().catch(() => undefined);
          }
        });
        soundRef.current = player;
        player.play();
      } else {
        soundRef.current.play();
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
      <Pressable
        onPress={togglePlay}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause voice message' : 'Play voice message'}
        style={[styles.playBtn, { backgroundColor: `${iconColor}22` }]}>
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
  track: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden', minWidth: 64 },
  fill: { height: 4, borderRadius: 2 },
  dur: { fontSize: 12, fontWeight: '600', minWidth: 36 },
});
