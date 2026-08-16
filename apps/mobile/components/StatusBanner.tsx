import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useOffline } from '@/src/offline/OfflineProvider';
import type { NetworkStatus } from '@hop/protocol';

function labelFor(status: NetworkStatus, queuedCount: number): NetworkStatus {
  if (status === 'Synchronizing') return 'Synchronizing';
  if (queuedCount > 0) return 'Queued';
  return status;
}

export function StatusBanner() {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const { status, queuedCount, identityError } = useOffline();
  const label = identityError ? 'Identity error' : labelFor(status, queuedCount);
  const active = !identityError && (label === 'Online' || label === 'Nearby');

  return (
    <View style={[styles.banner, { backgroundColor: colors.card }]}>
      <View style={[styles.dot, { backgroundColor: active ? colors.tint : identityError ? '#DC2626' : colors.muted }]} />
      <Text style={[styles.label, { color: identityError ? '#DC2626' : active ? colors.text : colors.muted }]}>
        {identityError ? 'Identity needs attention' : label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
});
