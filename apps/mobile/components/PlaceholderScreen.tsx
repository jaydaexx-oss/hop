import { StyleSheet } from 'react-native';

import { StatusBanner } from '@/components/StatusBanner';
import { Text, View } from '@/components/Themed';

export function PlaceholderScreen({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <View style={styles.container}>
      <StatusBanner />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  body: {
    fontSize: 16,
    lineHeight: 22,
    opacity: 0.7,
  },
});
