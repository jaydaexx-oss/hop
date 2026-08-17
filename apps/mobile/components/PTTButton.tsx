import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as FileSystem from 'expo-file-system/legacy';
import { MAX_VOICE_DURATION_MS, microphoneDeniedMessage } from '@hop/protocol';

const MIN_RECORDING_MS = 300;
const BAR_COUNT = 10;

export const SPEECH_RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 32_000,
  android: {
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 32_000,
  },
};

export type VoiceClip = {
  audio_b64: string;
  duration_ms: number;
  mime: string;
};

type PTTButtonProps = {
  tint: string;
  tintForeground: string;
  muted: string;
  card: string;
  onSend: (clip: VoiceClip) => void | Promise<void>;
};

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const t = Math.floor((ms % 1000) / 100);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${t}`;
}

export function PTTButton({ tint, tintForeground, muted, card, onSend }: PTTButtonProps) {
  const recorder = useAudioRecorder(SPEECH_RECORDING_OPTIONS);
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;
  const [granted, setGranted] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const startRef = useRef(0);
  const timerIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hapticIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);
  const stoppingRef = useRef(false);

  const clearAllIntervals = () => {
    if (timerIdRef.current) {
      clearInterval(timerIdRef.current);
      timerIdRef.current = null;
    }
    if (hapticIdRef.current) {
      clearInterval(hapticIdRef.current);
      hapticIdRef.current = null;
    }
  };

  const requestMic = useCallback(async () => {
    try {
      const { granted: ok } = await requestRecordingPermissionsAsync();
      setGranted(ok);
    } catch {
      setGranted(false);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      setGranted(false);
      return;
    }
    requestMic();
    return () => {
      abortRef.current = true;
      clearAllIntervals();
      if (recorderRef.current.isRecording) {
        recorderRef.current.stop().catch(() => undefined);
      }
      startedRef.current = false;
    };
  }, [requestMic]);

  const handlePressIn = useCallback(async () => {
    if (!granted || Platform.OS === 'web' || stoppingRef.current) return;
    abortRef.current = false;
    setError(null);
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      setError('Could not start recording');
      return;
    }
    if (abortRef.current) {
      recorder.stop().catch(() => undefined);
      return;
    }
    startedRef.current = true;
    startRef.current = Date.now();
    setRecording(true);
    setElapsed(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
    timerIdRef.current = setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 100);
    hapticIdRef.current = setInterval(() => {
      Haptics.selectionAsync().catch(() => undefined);
    }, 800);
  }, [granted, recorder]);

  const handlePressOut = useCallback(async () => {
    abortRef.current = true;
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    clearAllIntervals();
    setRecording(false);
    const duration = Math.min(Date.now() - startRef.current, MAX_VOICE_DURATION_MS);
    const recStarted = startedRef.current;
    startedRef.current = false;
    let uri: string | null = null;
    try {
      if (!recStarted || duration < MIN_RECORDING_MS) {
        if (recStarted) {
          await recorder.stop().catch(() => undefined);
          uri = recorder.uri;
        }
        return;
      }
      await recorder.stop();
      uri = recorder.uri;
      if (!uri) {
        setError('Recording produced no audio');
        return;
      }
      const audio_b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const mime = Platform.OS === 'ios' || Platform.OS === 'android' ? 'audio/mp4' : 'audio/webm';
      await onSend({ audio_b64, duration_ms: duration, mime });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Voice send failed');
    } finally {
      if (uri) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      }
      stoppingRef.current = false;
    }
  }, [onSend, recorder]);

  useEffect(() => {
    if (recording && elapsed >= MAX_VOICE_DURATION_MS) {
      handlePressOut().catch(() => undefined);
    }
  }, [recording, elapsed, handlePressOut]);

  if (Platform.OS === 'web') {
    return (
      <View style={styles.fallback}>
        <Text style={[styles.fallbackText, { color: muted }]}>Voice on mobile only</Text>
      </View>
    );
  }

  if (granted === false) {
    return (
      <Pressable onPress={requestMic} style={styles.fallback}>
        <Text style={[styles.fallbackText, { color: muted }]}>
          {microphoneDeniedMessage(false)}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.root}>
      {recording ? (
        <View style={styles.waveRow}>
          {Array.from({ length: BAR_COUNT }, (_, i) => {
            const phase = (elapsed / 180 + i * 0.45) % (Math.PI * 2);
            const h = 8 + Math.abs(Math.sin(phase)) * 16;
            return (
              <View key={i} style={[styles.waveBar, { height: h, backgroundColor: tint }]} />
            );
          })}
        </View>
      ) : null}
      {recording ? (
        <Text style={[styles.timer, { color: tint }]}>
          {fmt(elapsed)} · recording (not a mic meter)
        </Text>
      ) : null}
      {error ? <Text style={[styles.timer, { color: '#DC2626' }]}>{error}</Text> : null}
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.btn,
          {
            backgroundColor: recording ? tint : card,
            borderColor: recording ? tint : muted,
          },
        ]}>
        <Text style={[styles.mic, { color: recording ? tintForeground : tint }]}>
          {recording ? '●' : '○'}
        </Text>
        <Text style={[styles.btnLabel, { color: recording ? tintForeground : tint }]}>
          {recording ? 'RELEASE TO SEND' : 'HOLD TO HOP'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 8, paddingVertical: 6, flex: 1 },
  fallback: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, minHeight: 44, flex: 1 },
  fallbackText: { fontSize: 13, flex: 1, flexWrap: 'wrap' },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 32 },
  waveBar: { width: 3, borderRadius: 2, minHeight: 4 },
  timer: { fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  btn: {
    minWidth: 170,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 16,
  },
  mic: { fontSize: 18, fontWeight: '700' },
  btnLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
});
