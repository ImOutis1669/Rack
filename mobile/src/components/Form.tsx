// Small form pieces in Rack's style: labelled fields, a switch row, a primary button.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View, type TextInputProps } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { font, tabular } from '@/theme/type';

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  const { colors, text, customFont } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[text('footnote'), font('medium', customFont), { color: colors.muted }]}>{label}</Text>
      {children}
      {error || hint ? (
        <Text style={[text('caption'), { color: error ? colors.danger : colors.muted }]}>{error ?? hint}</Text>
      ) : null}
    </View>
  );
}

export function Input({ numeric, style, ...props }: TextInputProps & { numeric?: boolean }) {
  const { colors, text } = useTheme();
  return (
    <TextInput
      placeholderTextColor={colors.subtle}
      {...props}
      style={[styles.input, text('body'), { fontSize: 17, color: colors.foreground, backgroundColor: colors.surface }, numeric ? tabular : null, style]}
    />
  );
}

/** "£" + a price input with Clear, like the web's MoneyField. */
export function MoneyInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const { colors, text } = useTheme();
  return (
    <View style={[styles.money, { backgroundColor: colors.surface }]}>
      <Text style={[text('body'), { fontSize: 17, color: colors.muted }]}>£</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        accessibilityLabel={`${label} in pounds`}
        style={[text('body'), tabular, styles.moneyInput, { color: colors.foreground }]}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label}`} onPress={() => onChange('')} hitSlop={8}>
          <Text style={[text('footnote'), { color: colors.muted }]}>Clear</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function SwitchRow({
  label,
  value,
  onChange,
  disabled,
  detail,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  detail?: string;
}) {
  const { colors, text } = useTheme();
  return (
    <View style={[styles.switchRow, { opacity: disabled ? 0.4 : 1 }]}>
      <View style={{ flex: 1 }}>
        <Text style={[text('body'), { fontSize: 17, color: colors.foreground }]}>{label}</Text>
        {detail ? <Text style={[text('footnote'), { color: colors.muted }]}>{detail}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} />
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'secondary' | 'danger';
}) {
  const { colors, text } = useTheme();
  const bg = tone === 'primary' ? colors.foreground : colors.fill;
  const fg = tone === 'primary' ? colors.background : tone === 'danger' ? colors.danger : colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <Text style={[text('headline'), { fontSize: 17, color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  input: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, borderCurve: 'continuous' },
  money: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderRadius: 12, paddingHorizontal: 12, gap: 6, borderCurve: 'continuous' },
  moneyInput: { flex: 1, fontSize: 17, height: 44 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 44 },
  button: { minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
});
