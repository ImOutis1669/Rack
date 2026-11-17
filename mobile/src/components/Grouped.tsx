// iOS inset grouped lists (DESIGN.md: radius 16 sections, hairline separators, 44pt rows).
import { Children, Fragment, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { tabular } from '@/theme/type';

import { Icon } from './Icon';

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
  /** Smaller second line under the label. */
  detail?: string;
  onPress?: () => void;
  destructive?: boolean;
  /** Navigation row: a chevron on the right (iOS: chevrons only for navigation). */
  chevron?: boolean;
  /** A status dot before the value. */
  dot?: string;
  /** Anything on the right instead of `value`: an input, a switch, a button. */
  right?: ReactNode;
  /** VoiceOver hint for what a tap does */
  hint?: string;
}

export function Row({ label, value, detail, onPress, destructive, chevron, dot, right, hint }: RowProps) {
  const { colors, text } = useTheme();
  const body = (
    <View style={styles.row}>
      <View style={styles.labels}>
        <Text style={[text('body'), { color: destructive ? colors.danger : colors.foreground, fontSize: 17 }]}>{label}</Text>
        {detail ? <Text style={[text('footnote'), { color: colors.muted }]}>{detail}</Text> : null}
      </View>
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
      {right ??
        (value ? (
          <Text numberOfLines={1} style={[text('body'), styles.value, { color: colors.muted, fontSize: 17 }]}>
            {value}
          </Text>
        ) : null)}
      {chevron ? <Icon name="chevron-right" size={14} color={colors.subtle} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[label, value, detail].filter(Boolean).join(', ')}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.fill : 'transparent' })}>
      {body}
    </Pressable>
  );
}

/** A grouped row with a right-aligned text field (iOS settings style), optional £ / unit. */
export function InputRow({
  label,
  value,
  onChange,
  placeholder,
  prefix,
  suffix,
  numeric,
  width = 110,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  numeric?: boolean;
  width?: number;
}) {
  const { colors, text } = useTheme();
  return (
    <Row
      label={label}
      right={
        <View style={styles.inputWrap}>
          {prefix ? <Text style={[text('body'), { fontSize: 17, color: colors.muted }]}>{prefix}</Text> : null}
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={colors.subtle}
            accessibilityLabel={label}
            keyboardType={numeric ? 'decimal-pad' : 'default'}
            autoCorrect={false}
            style={[text('body'), numeric ? tabular : null, { fontSize: 17, color: colors.foreground, width, textAlign: 'right', paddingVertical: 0 }]}
          />
          {suffix ? <Text style={[text('footnote'), { color: colors.muted, width: 22 }]}>{suffix}</Text> : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  section: { marginHorizontal: 16, marginBottom: 28 },
  heading: { marginLeft: 16, marginBottom: 6 },
  box: { borderRadius: 16, overflow: 'hidden', borderCurve: 'continuous' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  row: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 8 },
  // the label takes the free space, so a chevron or control always sits at the right edge
  labels: { flexGrow: 1, flexShrink: 1, gap: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, marginLeft: 'auto' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto' },
  value: { flexShrink: 1, maxWidth: '60%', textAlign: 'right', marginLeft: 4 },
  footer: { marginLeft: 16, marginTop: 6 },
});
