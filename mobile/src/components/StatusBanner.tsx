import { useNetworkState } from 'expo-network';
import { StyleSheet, Text, View } from 'react-native';

import { describeError } from '@/lib/errors';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/type';

/**
 * A quiet line above a list when it's showing saved data because loading failed: offline, or
 * the server can't be reached. Nothing when all is well.
 */
export function StatusBanner({ error, showingSaved }: { error: unknown; showingSaved: boolean }) {
  const net = useNetworkState();
  const { colors, text, customFont } = useTheme();
  if (!error) return null;
  const p = describeError(error, net.isConnected);
  return (
    <View accessibilityLiveRegion="polite" style={[styles.banner, { backgroundColor: colors.fill }]}>
      <Text style={[text('footnote'), font('medium', customFont), { color: colors.foreground }]}>{p.message}</Text>
      {showingSaved ? (
        <Text style={[text('footnote'), { color: colors.muted }]}>Showing what you saw last. Pull down to try again.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { marginHorizontal: 6, marginBottom: 16, padding: 12, borderRadius: 12, gap: 2, borderCurve: 'continuous' },
});
