import { CATEGORIES, type Profile } from '@rack/shared/types';
import { useState } from 'react';
import { ScrollView } from 'react-native';

import { InputRow, Section } from '@/components/Grouped';
import { budgetFrom, CAT_LABEL } from '@/features/settings/profileForm';
import { SaveButton, useSaveProfile, WithProfile } from '@/features/settings/useProfile';
import { useTheme } from '@/theme/ThemeProvider';

export default function BudgetPage() {
  return <WithProfile>{(p) => <BudgetForm profile={p} />}</WithProfile>;
}

function BudgetForm({ profile }: { profile: Profile }) {
  const { colors } = useTheme();
  const save = useSaveProfile();
  const [def, setDef] = useState(profile.budget.default_max_gbp == null ? '' : String(profile.budget.default_max_gbp));
  const [per, setPer] = useState<Record<string, string>>(
    Object.fromEntries(CATEGORIES.map((c) => [c, profile.budget.per_category[c] == null ? '' : String(profile.budget.per_category[c])])),
  );
  const [dirty, setDirty] = useState(false);
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingTop: 16 }} keyboardShouldPersistTaps="handled">
      <SaveButton
        dirty={dirty}
        pending={save.isPending}
        onPress={() => save.mutate({ ...profile, budget: budgetFrom(def, per) }, { onSuccess: () => setDirty(false) })}
      />
      <Section footer="Maximum price. Category limits override the default.">
        <InputRow
          label="Default"
          numeric
          prefix="£"
          placeholder="None"
          value={def}
          onChange={(v) => {
            setDef(v);
            setDirty(true);
          }}
        />
        {CATEGORIES.map((c) => (
          <InputRow
            key={c}
            label={CAT_LABEL[c]}
            numeric
            prefix="£"
            placeholder="Default"
            value={per[c] ?? ''}
            onChange={(v) => {
              setPer({ ...per, [c]: v });
              setDirty(true);
            }}
          />
        ))}
      </Section>
    </ScrollView>
  );
}
