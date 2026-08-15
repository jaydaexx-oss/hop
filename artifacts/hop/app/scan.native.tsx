import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useHop } from '@/context/HopContext';
import { parseQRValue } from '@/components/QRCodeModal';

export default function ScanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { openDirectMessage, profile } = useHop();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useRef(false);

  const handleBarcode = useCallback(({ data }: { data: string }) => {
    if (cooldown.current || scanned) return;
    cooldown.current = true;

    const parsed = parseQRValue(data);
    if (!parsed) {
      setError('Not a valid HOP code. Try again.');
      setTimeout(() => { cooldown.current = false; setError(null); }, 2000);
      return;
    }

    if (parsed.id === profile?.id) {
      setError("That's your own code!");
      setTimeout(() => { cooldown.current = false; setError(null); }, 2000);
      return;
    }

    setScanned(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const userId = openDirectMessage({
      id: parsed.id,
      username: parsed.username,
      color: parsed.color,
      signal: 90,
      angle: 0,
    });

    // Brief pause so the success state is visible, then navigate
    setTimeout(() => {
      router.replace(`/chat/${userId}`);
    }, 400);
  }, [scanned, profile, openDirectMessage]);

  if (!permission) {
    return <View style={[styles.container, { backgroundColor: colors.background }]} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.permBox, { paddingTop: insets.top + 20 }]}>
          <Ionicons name="camera-outline" size={56} color={colors.mutedForeground} style={{ marginBottom: 16 }} />
          <Text style={[styles.permTitle, { color: colors.foreground }]}>Camera access needed</Text>
          <Text style={[styles.permSub, { color: colors.mutedForeground }]}>
            Allow camera access to scan HOP codes and instantly connect with nearby people.
          </Text>
          <Pressable
            onPress={requestPermission}
            style={[styles.permBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.permBtnText, { color: colors.primaryForeground }]}>Allow camera</Text>
          </Pressable>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
            <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      {/* Live camera */}
      {Platform.OS !== 'web' ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={scanned ? undefined : handleBarcode}
        />
      ) : (
        // Web fallback — expo-camera doesn't support web scanning
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#111', justifyContent: 'center', alignItems: 'center' }]}>
          <Ionicons name="camera-outline" size={64} color="#555" />
          <Text style={{ color: '#666', marginTop: 12, fontFamily: 'Inter_400Regular' }}>
            Camera scanning not supported on web
          </Text>
        </View>
      )}

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={[styles.closeBtn, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <Ionicons name="close" size={22} color="#fff" />
        </Pressable>
        <Text style={styles.topTitle}>Scan HOP Code</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Viewfinder */}
      <View style={styles.viewfinderArea}>
        <View style={[styles.viewfinder, scanned ? styles.viewfinderSuccess : error ? styles.viewfinderError : null]}>
          {/* Corner brackets */}
          {(['tl','tr','bl','br'] as const).map(pos => (
            <View
              key={pos}
              style={[
                styles.corner,
                pos === 'tl' && { top: -2, left: -2 },
                pos === 'tr' && { top: -2, right: -2, transform: [{ scaleX: -1 }] },
                pos === 'bl' && { bottom: -2, left: -2, transform: [{ scaleY: -1 }] },
                pos === 'br' && { bottom: -2, right: -2, transform: [{ scaleX: -1 }, { scaleY: -1 }] },
                { borderColor: scanned ? '#00FF88' : error ? '#FF4444' : '#00CCFF' },
              ]}
            />
          ))}
        </View>

        {/* Status message */}
        <View style={[styles.statusPill, {
          backgroundColor: scanned ? 'rgba(0,255,136,0.15)' : error ? 'rgba(255,68,68,0.15)' : 'rgba(0,204,255,0.12)',
          borderColor: scanned ? '#00FF88' : error ? '#FF4444' : '#00CCFF44',
        }]}>
          {scanned ? (
            <Ionicons name="checkmark-circle" size={16} color="#00FF88" />
          ) : error ? (
            <Ionicons name="alert-circle" size={16} color="#FF4444" />
          ) : (
            <Ionicons name="scan-outline" size={16} color="#00CCFF" />
          )}
          <Text style={[styles.statusText, {
            color: scanned ? '#00FF88' : error ? '#FF4444' : '#00CCFF',
          }]}>
            {scanned ? 'Code found — opening chat…' : error ?? 'Aim at a HOP QR code'}
          </Text>
        </View>
      </View>

      {/* Bottom hint */}
      <View style={[styles.bottomHint, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={styles.hintText}>
          Ask the other person to show their QR code from their Profile tab
        </Text>
      </View>
    </View>
  );
}

const FINDER_SIZE = 240;

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  closeBtn: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
  },
  topTitle: {
    color: '#fff',
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  viewfinderArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 28,
  },
  viewfinder: {
    width: FINDER_SIZE,
    height: FINDER_SIZE,
    position: 'relative',
  },
  viewfinderSuccess: {},
  viewfinderError: {},
  corner: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderRadius: 3,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  bottomHint: {
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  hintText: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 18,
  },
  // Permission screen
  permBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
  },
  permTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    marginBottom: 12,
    textAlign: 'center',
  },
  permSub: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
  },
  permBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
  },
  permBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  cancelText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
});
