// iOS inset grouped lists (DESIGN.md: radius 16 sections, hairline separators, 44pt rows).
import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

export function Section({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const { colors, text } = useTheme();
  const rows = Children.toArray(children);
  return (
    <View style={styles.section}>
      {title ? (
        <Text style={[text('footnote'), styles.heading, { color: colors.muted }]}>{title.toUpperCase()}</Text>
      ) : null}
      <View style={[styles.box, { backgroundColor: colors.surface }]}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={[styles.separator, { backgroundColor: colors.border }]} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? <Text style={[text('footnote'), styles.footer, { color: colors.muted }]}>{footer}</Text> : null}
    </View>
  );
}

interface RowProps {
  label: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  /** VoiceOver hint for what a tap does */
  hint?: string;
}

export function Row({ label, value, onPress, destructive, hint }: RowProps) {
  const { colors, text } = useTheme();
  const body = (
    <View style={styles.row}>
      <Text style={[text('body'), { color: destructive ? colors.danger : colors.foreground, fontSize: 17 }]}>
        {label}
      </Text>
      {value ? (
        <Text numberOfLines={1} style={[text('body'), styles.value, { color: colors.muted, fontSize: 17 }]}>
          {value}
        </Text>
      ) : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.fill : 'transparent' })}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { marginHorizontal: 16, marginBottom: 28 },
  heading: { marginLeft: 16, marginBottom: 6 },
  box: { borderRadius: 16, overflow: 'hidden', borderCurve: 'continuous' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  row: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 11, flexDirection: 'row', alignItems: 'center' },
  value: { flex: 1, textAlign: 'right', marginLeft: 12 },
  footer: { marginLeft: 16, marginTop: 6 },
});
