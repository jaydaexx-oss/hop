import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { classifyApiDeployment } from '@hop/protocol';

import { Text } from '@/components/Themed';
import { API_URL, getVersion } from '@/src/api/client';

type Props = {
  /** Full-width top bar (root layout). Compact is a card-sized chip. */
  compact?: boolean;
};

export function ApiEnvironmentBanner({ compact = false }: Props) {
  const insets = useSafeAreaInsets();
  const [versionEnv, setVersionEnv] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((body) => {
        if (!cancelled) setVersionEnv(body.env);
      })
      .catch(() => {
        if (!cancelled) setVersionEnv(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const info = classifyApiDeployment(API_URL, versionEnv);
  const production = info.kind === 'production';
  const backgroundColor = production ? '#7f1d1d' : '#14532d';
  const title = info.mismatch
    ? `${info.label} · URL and /version disagree`
    : info.label;
  const detail = versionEnv
    ? `${info.host} · /version env=${versionEnv}`
    : info.host;

  return (
    <View
      style={[
        compact ? styles.compact : styles.bar,
        { backgroundColor, paddingTop: compact ? 8 : Math.max(insets.top, 8) },
      ]}
      accessibilityRole="text"
      accessibilityLabel={`${info.label} API ${detail}`}>
      <Text style={styles.label}>{title}</Text>
      <Text style={styles.detail}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 2,
  },
  compact: {
    alignSelf: 'stretch',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 2,
  },
  label: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
  detail: {
    color: '#e5e7eb',
    fontSize: 12,
    fontWeight: '600',
  },
});
