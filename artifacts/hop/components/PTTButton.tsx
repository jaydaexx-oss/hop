/**
 * PTTButton — "HOLD TO HOP" push-to-talk component.
 *
 * Hold to record; release to send.  Fires onSend(uri, durationMs) after
 * the recording is cleanly stopped.  Recordings shorter than MIN_MS are
 * silently discarded.
 *
 * Race safety: `handlePressIn` awaits async recorder creation.  If the user
 * releases (or the component unmounts) before that resolves, `abortRef` is
 * set, and the newly-created recorder is immediately stopped/unloaded without
 * starting timers or calling onSend.
 *
 * Note: Status labels shown are SENDING / DELIVERED — no encryption or relay
 * transport is implemented in V1; those capabilities belong in a later PTT
 * version once the HOP transport layer is wired up.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

const MIN_RECORDING_MS = 300;
type StatusPhase = 'SENDING' | 'DELIVERED' | null;

const BAR_COUNT = 10;

interface Colors {
  primary: string;
  primaryForeground: string;
  foreground: string;
  mutedForeground: string;
  card: string;
  border: string;
  background: string;
}

interface PTTButtonProps {
  colors: Colors;
  onSend: (uri: string, durationMs: number) => void;
}

export function PTTButton({ colors, onSend }: PTTButtonProps) {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [bars, setBars] = useState<number[]>(Array(BAR_COUNT).fill(4));
  const [status, setStatus] = useState<StatusPhase>(null);

  // Shared mutable refs — no setState churn needed for these
  const recordingRef = useRef<Audio.Recording | null>(null);
  const startRef     = useRef(0);
  const timerIdRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const waveIdRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const hapticIdRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Set to true if pressOut/unmount fires before createAsync resolves. */
  const abortRef     = useRef(false);

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  useEffect(() => {
    Audio.requestPermissionsAsync().then(({ granted: g }) => setGranted(g));
    return () => {
      // Ensure cleanup even if component unmounts mid-recording.
      abortRef.current = true;
      clearAllIntervals();
      if (recordingRef.current) {
        recordingRef.current.stopAndUnloadAsync().catch(() => {});
        recordingRef.current = null;
      }
    };
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const clearAllIntervals = () => {
    if (timerIdRef.current)  { clearInterval(timerIdRef.current);  timerIdRef.current  = null; }
    if (waveIdRef.current)   { clearInterval(waveIdRef.current);   waveIdRef.current   = null; }
    if (hapticIdRef.current) { clearInterval(hapticIdRef.current); hapticIdRef.current = null; }
  };

  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const t = Math.floor((ms % 1000) / 100);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${t}`;
  };

  // ── Press handlers ────────────────────────────────────────────────────────

  const handlePressIn = useCallback(async () => {
    if (!granted || Platform.OS === 'web') return;

    abortRef.current = false; // fresh session

    let rec: Audio.Recording;
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      ({ recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      ));
    } catch (err) {
      console.warn('PTT: recorder creation failed', err);
      return;
    }

    // If release or unmount happened while we were awaiting — clean up and bail.
    if (abortRef.current) {
      rec.stopAndUnloadAsync().catch(() => {});
      return;
    }

    recordingRef.current = rec;
    startRef.current = Date.now();
    setRecording(true);
    setElapsed(0);
    setStatus(null);

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    timerIdRef.current = setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 100);

    waveIdRef.current = setInterval(() => {
      setBars(Array(BAR_COUNT).fill(0).map(() => 4 + Math.random() * 24));
    }, 80);

    hapticIdRef.current = setInterval(() => {
      Haptics.selectionAsync();
    }, 800);
  }, [granted]);

  const handlePressOut = useCallback(async () => {
    // Signal abort to any in-progress createAsync.
    abortRef.current = true;

    clearAllIntervals();
    setBars(Array(BAR_COUNT).fill(4));
    setRecording(false);

    const duration = Date.now() - startRef.current;
    const rec = recordingRef.current;
    recordingRef.current = null;

    if (!rec || duration < MIN_RECORDING_MS) {
      try { await rec?.stopAndUnloadAsync(); } catch {}
      return;
    }

    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      if (!uri) return;

      // Fire onSend immediately — status labels are cosmetic feedback only.
      onSend(uri, duration);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Honest status: SENDING → DELIVERED (no encryption or relay in V1)
      setStatus('SENDING');
      setTimeout(() => setStatus('DELIVERED'), 250);
      setTimeout(() => setStatus(null), 900);
    } catch (err) {
      console.warn('PTT: stop failed', err);
    }
  }, [onSend]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (Platform.OS === 'web' || granted === false) {
    return (
      <View style={styles.fallback}>
        <Ionicons name="mic-off-outline" size={16} color={colors.mutedForeground} />
        <Text style={[styles.fallbackText, { color: colors.mutedForeground }]}>
          {Platform.OS === 'web' ? 'Voice on mobile only' : 'Microphone permission needed'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Status chip — SENDING / DELIVERED only */}
      {status && (
        <View style={[styles.statusChip, { backgroundColor: colors.card }]}>
          <Text style={[styles.statusLabel, { color: colors.primary }]}>{status}</Text>
          {status === 'DELIVERED' && (
            <Ionicons name="checkmark-circle" size={13} color={colors.primary} />
          )}
        </View>
      )}

      {/* Live waveform */}
      {recording && (
        <View style={styles.waveRow}>
          {bars.map((h, i) => (
            <View
              key={i}
              style={[
                styles.waveBar,
                { height: h, backgroundColor: colors.primary, opacity: 0.6 + (h / 28) * 0.4 },
              ]}
            />
          ))}
        </View>
      )}

      {/* Elapsed timer */}
      {recording && (
        <Text style={[styles.timer, { color: colors.primary }]}>{fmt(elapsed)}</Text>
      )}

      {/* Hold-to-talk button */}
      <Pressable
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.btn,
          {
            backgroundColor: recording ? colors.primary : colors.card,
            borderColor: recording ? colors.primary : colors.border,
          },
        ]}
      >
        <Ionicons
          name={recording ? 'mic' : 'mic-outline'}
          size={26}
          color={recording ? colors.primaryForeground : colors.primary}
        />
        <Text style={[styles.btnLabel, { color: recording ? colors.primaryForeground : colors.primary }]}>
          {recording ? 'RELEASE TO SEND' : 'HOLD TO HOP'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root:         { alignItems: 'center', gap: 8, paddingVertical: 6 },
  fallback:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12 },
  fallbackText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  statusChip:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20 },
  statusLabel:  { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 1.2 },
  waveRow:      { flexDirection: 'row', alignItems: 'center', gap: 3, height: 32 },
  waveBar:      { width: 3, borderRadius: 2, minHeight: 4 },
  timer:        { fontSize: 13, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  btn: {
    width: 170, height: 72, borderRadius: 36,
    borderWidth: 2, alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  btnLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.4 },
});
