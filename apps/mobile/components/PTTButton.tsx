import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
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
import {
  MAX_VOICE_DURATION_MS,
  MIN_VOICE_DURATION_MS,
  microphoneDeniedMessage,
  shouldSendVoiceClip,
  slideLeftCancelsRecording,
} from '@hop/protocol';

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
  disabled?: boolean;
  onSend: (clip: VoiceClip) => void | Promise<void>;
  onRecordingChange?: (recording: boolean) => void;
};

function fmt(ms: number): string {
  const s = Math.min(Math.floor(ms / 1000), Math.floor(MAX_VOICE_DURATION_MS / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function PTTButton({
  tint,
  tintForeground,
  muted,
  card,
  disabled,
  onSend,
  onRecordingChange,
}: PTTButtonProps) {
  const recorder = useAudioRecorder(SPEECH_RECORDING_OPTIONS);
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;
  const [granted, setGranted] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const startRef = useRef(0);
  const startXRef = useRef(0);
  const cancelRef = useRef(false);
  const timerIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);
  const stoppingRef = useRef(false);

  const clearTimer = () => {
    if (timerIdRef.current) {
      clearInterval(timerIdRef.current);
      timerIdRef.current = null;
    }
  };

  const setRecordingUi = (value: boolean) => {
    setRecording(value);
    onRecordingChange?.(value);
  };

  const discardUri = async (uri: string | null) => {
    if (!uri) return;
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  };

  const requestMic = useCallback(async () => {
    try {
      const { granted: ok } = await requestRecordingPermissionsAsync();
      setGranted(ok);
      return ok;
    } catch {
      setGranted(false);
      return false;
    }
  }, []);

  const cancelRecording = useCallback(async (reason?: string) => {
    abortRef.current = true;
    cancelRef.current = true;
    clearTimer();
    setRecordingUi(false);
    setCancelling(false);
    const recStarted = startedRef.current;
    startedRef.current = false;
    if (recStarted) {
      await recorderRef.current.stop().catch(() => undefined);
      await discardUri(recorderRef.current.uri);
    }
    if (reason) setError(reason);
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      setGranted(false);
      return;
    }
    return () => {
      abortRef.current = true;
      clearTimer();
      if (recorderRef.current.isRecording) {
        recorderRef.current.stop().catch(() => undefined);
      }
      startedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && startedRef.current) {
        void cancelRecording();
      }
    });
    return () => sub.remove();
  }, [cancelRecording]);

  const handlePressIn = useCallback(
    async (event: GestureResponderEvent) => {
      if (disabled || Platform.OS === 'web' || stoppingRef.current) return;
      let ok = granted;
      if (ok !== true) {
        ok = await requestMic();
        if (!ok) {
          setError(microphoneDeniedMessage(false));
          return;
        }
      }
      abortRef.current = false;
      cancelRef.current = false;
      setCancelling(false);
      setError(null);
      startXRef.current = event.nativeEvent.pageX;
      try {
        await setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
          interruptionMode: 'doNotMix',
        });
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
      setRecordingUi(true);
      setElapsed(0);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      timerIdRef.current = setInterval(() => {
        setElapsed(Date.now() - startRef.current);
      }, 100);
    },
    [disabled, granted, recorder, requestMic],
  );

  const handleMove = useCallback((event: GestureResponderEvent) => {
    if (!startedRef.current) return;
    const cancel = slideLeftCancelsRecording(startXRef.current, event.nativeEvent.pageX);
    cancelRef.current = cancel;
    setCancelling(cancel);
  }, []);

  const finishRecording = useCallback(
    async (forceSend: boolean) => {
      abortRef.current = true;
      if (stoppingRef.current) return;
      stoppingRef.current = true;
      clearTimer();
      setRecordingUi(false);
      setCancelling(false);
      const duration = Math.min(Date.now() - startRef.current, MAX_VOICE_DURATION_MS);
      const recStarted = startedRef.current;
      const cancelled = !forceSend && cancelRef.current;
      startedRef.current = false;
      cancelRef.current = false;
      let uri: string | null = null;
      try {
        if (!recStarted) return;
        await recorder.stop().catch(() => undefined);
        uri = recorder.uri;
        if (!shouldSendVoiceClip({ durationMs: duration, cancelled })) {
          return;
        }
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
        await discardUri(uri);
        stoppingRef.current = false;
      }
    },
    [onSend, recorder],
  );

  const handlePressOut = useCallback(() => {
    void finishRecording(false);
  }, [finishRecording]);

  useEffect(() => {
    if (recording && elapsed >= MAX_VOICE_DURATION_MS && !cancelRef.current) {
      void finishRecording(true);
    }
  }, [recording, elapsed, finishRecording]);

  if (Platform.OS === 'web') {
    return null;
  }

  if (granted === false) {
    return (
      <View style={styles.deniedWrap}>
        <Pressable
          onPress={() => {
            void Linking.openSettings();
          }}
          accessibilityRole="button"
          accessibilityLabel="Open Settings to enable the microphone"
          style={[styles.mic, { backgroundColor: card, borderColor: muted }]}>
          <Text style={[styles.micGlyph, { color: muted }]}>🎤</Text>
        </Pressable>
        <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="link">
          <Text style={[styles.denied, { color: '#DC2626' }]}>
            {error ?? microphoneDeniedMessage(false)} Open Settings
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {recording ? (
        <View
          style={[
            styles.banner,
            { backgroundColor: cancelling ? '#7F1D1D' : tint },
          ]}
          pointerEvents="none">
          <View style={[styles.dot, { backgroundColor: tintForeground }]} />
          <Text style={[styles.bannerText, { color: tintForeground }]}>
            {cancelling ? 'Release to cancel' : `${fmt(elapsed)} · slide left to cancel`}
          </Text>
        </View>
      ) : null}
      {error && !recording ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        disabled={disabled}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onTouchMove={handleMove}
        accessibilityRole="button"
        accessibilityLabel={recording ? 'Recording voice message' : 'Hold to record a voice message'}
        style={[
          styles.mic,
          {
            backgroundColor: recording ? (cancelling ? '#DC2626' : tint) : card,
            borderColor: recording ? (cancelling ? '#DC2626' : tint) : muted,
            opacity: disabled ? 0.45 : 1,
          },
        ]}>
        <Text style={[styles.micGlyph, { color: recording ? tintForeground : tint }]}>🎤</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'flex-end' },
  deniedWrap: { alignItems: 'center', maxWidth: 160 },
  denied: { fontSize: 11, marginTop: 4, textAlign: 'center' },
  mic: {
    width: 44,
    minHeight: 44,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micGlyph: { fontSize: 18 },
  banner: {
    position: 'absolute',
    right: 52,
    bottom: 4,
    minHeight: 36,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 180,
  },
  bannerText: { fontSize: 12, fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  error: { color: '#DC2626', fontSize: 11, marginBottom: 4, maxWidth: 140, textAlign: 'center' },
});
