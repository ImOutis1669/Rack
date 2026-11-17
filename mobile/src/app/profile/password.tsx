// Change password (v2.1): the server ends your other sessions; this phone keeps going with the
// new token it gets back (Session.changePassword).
import { passwordProblem } from '@rack/shared/account';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Section } from '@/components/Grouped';
import { useToast } from '@/components/Toast';
import { useSession } from '@/lib/auth';
import { useAccount } from '@/lib/useAccount';
import { useTheme } from '@/theme/ThemeProvider';

export default function PasswordScreen() {
  const session = useSession();
  const toast = useToast();
  const account = useAccount();
  const { colors, text } = useTheme();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const problem = next
    ? passwordProblem(next, account.data?.username) || (again && again !== next ? 'The two new passwords differ' : '')
    : '';
  const change = useMutation({
    mutationFn: () => session.changePassword(current, next),
    onSuccess: () => {
      toast('Password changed. Your other devices are logged out.');
      router.back();
    },
  });
  const ready = !!current && !!next && again === next && !problem && !change.isPending;
  const field = [text('body'), styles.input, { color: colors.foreground }];
  const input = (label: string, value: string, set: (v: string) => void, kind: 'password' | 'newPassword') => (
    <View style={styles.row}>
      <TextInput
        value={value}
        onChangeText={set}
        placeholder={label}
        placeholderTextColor={colors.subtle}
        accessibilityLabel={label}
        secureTextEntry
        textContentType={kind}
        autoComplete={kind === 'password' ? 'current-password' : 'new-password'}
        style={field}
      />
    </View>
  );
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} keyboardShouldPersistTaps="handled">
      <Section>{input('Current password', current, setCurrent, 'password')}</Section>
      <Section footer={change.error instanceof Error ? change.error.message : problem || 'At least 12 characters. A few random words work well.'}>
        {input('New password', next, setNext, 'newPassword')}
        {input('New password again', again, setAgain, 'newPassword')}
      </Section>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !ready }}
        disabled={!ready}
        onPress={() => change.mutate()}
        style={({ pressed }) => [styles.button, { backgroundColor: colors.foreground, opacity: ready ? 1 : 0.4, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
        {change.isPending ? (
          <ActivityIndicator color={colors.background} />
        ) : (
          <Text style={[text('headline'), { color: colors.background, fontSize: 17 }]}>Change password</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  input: { fontSize: 17, paddingVertical: 10 },
  button: { marginHorizontal: 16, marginTop: 8, minHeight: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
});
