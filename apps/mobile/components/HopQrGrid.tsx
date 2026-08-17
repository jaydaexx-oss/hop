import { StyleSheet, View } from 'react-native';

import { hopQrModules } from '@hop/protocol';

export function HopQrGrid({ value, color = '#111827' }: { value: string; color?: string }) {
  const modules = hopQrModules(value);
  return (
    <View style={[styles.frame, { aspectRatio: 1 }]} accessibilityLabel="HOP QR code">
      {modules.map((row, y) => (
        <View key={y} style={styles.row}>
          {row.map((dark, x) => (
            <View
              key={`${y}-${x}`}
              style={{
                flex: 1,
                backgroundColor: dark ? color : 'transparent',
                aspectRatio: 1,
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    maxWidth: 280,
    alignSelf: 'center',
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
  },
  row: { flexDirection: 'row', flex: 1 },
});
