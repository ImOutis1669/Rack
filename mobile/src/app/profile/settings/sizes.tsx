import { CATEGORIES, type Profile } from '@rack/shared/types';
import { useState } from 'react';
import { ScrollView, Switch } from 'react-native';

import { InputRow, Row, Section } from '@/components/Grouped';
import { CAT_LABEL, SIZE_PLACEHOLDER, sizesFrom, sizeTexts } from '@/features/settings/profileForm';
import { SaveButton, useSaveProfile, WithProfile } from '@/features/settings/useProfile';
import { useTheme } from '@/theme/ThemeProvider';

export default function SizesPage() {
  return <WithProfile>{(p) => <SizesForm profile={p} />}</WithProfile>;
}

function SizesForm({ profile }: { profile: Profile }) {
  const { colors } = useTheme();
  const save = useSaveProfile();
  const [texts, setTexts] = useState(() => sizeTexts(profile));
  const [strict, setStrict] = useState(profile.strict_size);
  const [dirty, setDirty] = useState(false);
  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingTop: 16 }} keyboardShouldPersistTaps="handled">
      <SaveButton
        dirty={dirty}
        pending={save.isPending}
        onPress={() => save.mutate({ ...profile, sizes: sizesFrom(texts), strict_size: strict }, { onSuccess: () => setDirty(false) })}
      />
      <Section footer="Other sizes rank lower, or are hidden if you turn on the switch.">
        {CATEGORIES.map((c) => (
          <InputRow
            key={c}
            label={CAT_LABEL[c]}
            width={150}
            placeholder={SIZE_PLACEHOLDER[c] ?? 'L, XL'}
            value={texts[c] ?? ''}
            onChange={(v) => {
              setTexts({ ...texts, [c]: v });
              setDirty(true);
            }}
          />
        ))}
        <Row
          label="Hide other sizes"
          right={
            <Switch
              style={{ marginLeft: 'auto' }}
              value={strict}
              accessibilityLabel="Hide other sizes"
              onValueChange={(v) => {
                setStrict(v);
                setDirty(true);
              }}
            />
          }
        />
      </Section>
    </ScrollView>
  );
}
