import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/type';

import { Icon, type IconName } from './Icon';

/** Centred icon, title, text and an optional button (the web's EmptyState). */
export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}) {
  const { colors, text, customFont } = useTheme();
  return (
    <View style={styles.wrap}>
      <Icon name={icon} size={24} color={colors.muted} />
      <Text style={[text('title'), { color: colors.foreground, textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[text('footnote'), { color: colors.muted, textAlign: 'center' }]}>{body}</Text> : null}
      {action ? (
        <Pressable
          accessibilityRole="button"
          onPress={action.onPress}
          style={({ pressed }) => [styles.button, { backgroundColor: colors.foreground, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
          <Text style={[text('footnote'), font('medium', customFont), { color: colors.background }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 64, paddingHorizontal: 24, alignItems: 'center', gap: 8 },
  button: { marginTop: 8, minHeight: 44, paddingHorizontal: 18, borderRadius: 22, justifyContent: 'center' },
});
