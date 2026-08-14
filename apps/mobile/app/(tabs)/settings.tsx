import { Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { StatusBanner } from '@/components/StatusBanner';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useAuth } from '@/src/auth/AuthProvider';

export default function SettingsScreen() {
  const { user, logout } = useAuth();
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];

  return (
    <View style={styles.wrap}>
      <StatusBanner />
      <Text style={styles.title}>Profile</Text>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={{ color: colors.muted }}>Username</Text>
        <Text style={styles.username}>{user?.username}</Text>
      </View>
      <Text style={{ color: colors.muted, marginTop: 16 }}>
        Messages over the internet currently travel without end-to-end encryption (`alg: none`).
        Chat chooses internet or Nearby BLE automatically. BLE uses libsodium crypto_box after a
        public-key handshake and has not been verified on physical devices here. Mesh relay is not
        implemented.
      </Text>
      <Pressable onPress={logout} style={[styles.button, { borderColor: colors.tint }]}>
        <Text style={[styles.buttonLabel, { color: colors.tint }]}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 20 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 16 },
  card: { borderRadius: 16, padding: 16, gap: 4 },
  username: { fontSize: 22, fontWeight: '700' },
  button: { marginTop: 28, borderWidth: 1.5, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonLabel: { fontWeight: '700', fontSize: 16 },
});
