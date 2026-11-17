import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/type';

/** Capsule chip (DESIGN.md): fill at rest, inverted (foreground) when selected. */
export function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: ReactNode;
}) {
  const { colors, text, customFont } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: selected ? colors.foreground : colors.fill, transform: [{ scale: pressed ? 0.97 : 1 }] },
      ]}>
      {icon}
      <Text style={[text('footnote'), font('medium', customFont), { color: selected ? colors.background : colors.foreground }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6 },
});
