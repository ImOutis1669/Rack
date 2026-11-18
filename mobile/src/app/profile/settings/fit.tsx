import type { Profile } from '@rack/shared/types';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { InputRow, Section } from '@/components/Grouped';
import { Segmented } from '@/components/Segmented';
import { LENGTHS, lengthTexts, measurementsFrom, type LenKey } from '@/features/settings/profileForm';
import { SaveButton, useSaveProfile, WithProfile } from '@/features/settings/useProfile';
import { useTheme } from '@/theme/ThemeProvider';

export default function FitPage() {
  return <WithProfile>{(p) => <FitForm profile={p} />}</WithProfile>;
}

function FitForm({ profile }: { profile: Profile }) {
  const { colors, text } = useTheme();
  const save = useSaveProfile();
  const [unit, setUnit] = useState<'cm' | 'in'>('cm');
  const [texts, setTexts] = useState(() => lengthTexts(profile.measurements, 'cm'));
  const [edited, setEdited] = useState<Set<LenKey>>(new Set());
  const [tolerance, setTolerance] = useState(String(profile.measurements.tolerance_cm));
  const tol = Number(tolerance);
  const dirty = edited.size > 0 || tol !== profile.measurements.tolerance_cm;

  const switchUnit = (u: 'cm' | 'in') => {
    // show every value in the new unit; edited ones are converted from what you typed
    const now = measurementsFrom(profile.measurements, texts, edited, unit, profile.measurements.tolerance_cm);
    setTexts(lengthTexts(now, u));
    setUnit(u);
  };

  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingTop: 16 }} keyboardShouldPersistTaps="handled">
      <SaveButton
        dirty={dirty && Number.isFinite(tol) && tol >= 0}
        pending={save.isPending}
        onPress={() =>
          save.mutate(
            { ...profile, measurements: measurementsFrom(profile.measurements, texts, edited, unit, tol) },
            { onSuccess: () => setEdited(new Set()) },
          )
        }
      />
      <View style={{ marginHorizontal: 16, marginBottom: 16 }}>
        <Segmented
          label="Unit"
          value={unit}
          onChange={switchUnit}
          options={[
            ['cm', 'cm'],
            ['in', 'in'],
          ]}
        />
      </View>
      <Section footer="Listings whose measurements fall short by more than the tolerance are hidden. Listings without measurements are never hidden for it.">
        {LENGTHS.map(([k, label]) => (
          <InputRow
            key={k}
            label={label}
            numeric
            placeholder="Any"
            suffix={unit}
            value={texts[k]}
            onChange={(v) => {
              setTexts({ ...texts, [k]: v });
              setEdited((s) => new Set(s).add(k));
            }}
          />
        ))}
        <InputRow label="Tolerance" numeric suffix="cm" value={tolerance} onChange={setTolerance} />
      </Section>
      {save.isError ? <Text style={[text('footnote'), { color: colors.danger, marginHorizontal: 32 }]}>{(save.error as Error).message}</Text> : null}
    </ScrollView>
  );
}
