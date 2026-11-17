import type { Profile } from '@rack/shared/types';
import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';

import { SaveButton, useSaveProfile, WithProfile } from '@/features/settings/useProfile';
import { useTheme } from '@/theme/ThemeProvider';

export default function StylePage() {
  return <WithProfile>{(p) => <StyleForm profile={p} />}</WithProfile>;
}

function StyleForm({ profile }: { profile: Profile }) {
  const { colors, text } = useTheme();
  const save = useSaveProfile();
  const [context, setContext] = useState(profile.context);
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: 16, gap: 8 }} keyboardShouldPersistTaps="handled">
      <SaveButton dirty={context !== profile.context} pending={save.isPending} onPress={() => save.mutate({ ...profile, context })} />
      <TextInput
        value={context}
        onChangeText={setContext}
        multiline
        autoFocus
        accessibilityLabel="Your style"
        placeholder="Dark, draped, minimal. Long silhouettes, heavy cotton and wool, no logos."
        placeholderTextColor={colors.subtle}
        style={[text('body'), { fontSize: 17, color: colors.foreground, backgroundColor: colors.surface, borderRadius: 16, padding: 16, minHeight: 160, textAlignVertical: 'top' }]}
      />
      <Text style={[text('footnote'), { color: colors.muted, paddingHorizontal: 16 }]}>
        A few words about what you like. Rack matches them against listing text and photos.
      </Text>
      {save.isError ? <Text style={[text('footnote'), { color: colors.danger }]}>{(save.error as Error).message}</Text> : null}
    </ScrollView>
  );
}
