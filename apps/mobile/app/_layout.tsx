import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { AuthProvider, useAuth } from '@/src/auth/AuthProvider';
import { BleProvider } from '@/src/ble/BleProvider';
import { NearbyProvider } from '@/src/nearby/NearbyProvider';
import { OfflineProvider } from '@/src/offline/OfflineProvider';
import { clearVoicePlaybackTemps } from '@/src/voice/cache';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    clearVoicePlaybackTemps().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return (
    <AuthProvider>
      <OfflineProvider>
        <BleProvider>
          <NearbyProvider>
            <RootLayoutNav />
          </NearbyProvider>
        </BleProvider>
      </OfflineProvider>
    </AuthProvider>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();
  const { ready } = useAuth();

  if (!ready) return null;

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ title: 'Chat' }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="device-diagnostics" options={{ title: 'Diagnostics' }} />
        <Stack.Screen name="qr" options={{ title: 'My HOP QR Code' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan HOP code' }} />
        <Stack.Screen name="requests" options={{ title: 'Message requests' }} />
        <Stack.Screen name="events/index" options={{ title: 'Events' }} />
        <Stack.Screen name="events/create" options={{ title: 'Create Event' }} />
        <Stack.Screen name="events/[id]" options={{ title: 'Event' }} />
        <Stack.Screen name="nearby-profile" options={{ title: 'Nearby profile' }} />
        <Stack.Screen name="ble-debug" options={{ title: 'BLE debug' }} />
      </Stack>
    </ThemeProvider>
  );
}
