import { Host, Slider } from '@expo/ui/swift-ui';
import { CATEGORIES, type Profile, type Weights } from '@rack/shared/types';
import { splitList } from '@rack/shared/units';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { Row, Section } from '@/components/Grouped';
import { CAT_LABEL } from '@/features/settings/profileForm';
import { SaveButton, useSaveProfile, WithProfile } from '@/features/settings/useProfile';
import { useTheme } from '@/theme/ThemeProvider';
import { tabular } from '@/theme/type';

export default function FeedPage() {
  return <WithProfile>{(p) => <FeedForm profile={p} />}</WithProfile>;
}

function FeedForm({ profile }: { profile: Profile }) {
  const { colors, text } = useTheme();
  const save = useSaveProfile();
  const [p, setP] = useState(profile);
  const [banned, setBanned] = useState(profile.banned_keywords.join(', '));
  const [weights, setWeights] = useState<Record<keyof Weights, string>>(
    Object.fromEntries(Object.entries(profile.weights).map(([k, v]) => [k, String(v)])) as Record<keyof Weights, string>,
  );
  const [advanced, setAdvanced] = useState(false);
  const [dirty, setDirty] = useState(false);
  const update = (next: Profile) => {
    setP(next);
    setDirty(true);
  };
  const parsedWeights = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Number(v)])) as unknown as Weights;
  const weightsOk = Object.values(parsedWeights).every((n) => Number.isFinite(n) && n >= 0);

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingTop: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <SaveButton
        dirty={dirty && weightsOk}
        pending={save.isPending}
        onPress={() =>
          save.mutate({ ...p, banned_keywords: splitList(banned), weights: parsedWeights }, { onSuccess: () => setDirty(false) })
        }
      />
      <Section title="Show in the feed">
        {CATEGORIES.map((c) => (
          <Row
            key={c}
            label={CAT_LABEL[c]}
            right={
              <Switch
                style={{ marginLeft: 'auto' }}
                accessibilityLabel={`Show ${CAT_LABEL[c]}`}
                value={p.categories.includes(c)}
                onValueChange={(v) => update({ ...p, categories: v ? [...p.categories, c] : p.categories.filter((x) => x !== c) })}
              />
            }
          />
        ))}
      </Section>
      <Section title="Exploration" footer="Wildcards from outside your top matches, so the feed doesn't narrow too far.">
        <View style={styles.slider}>
          <Host matchContents={{ vertical: true }} style={{ flex: 1 }}>
            <Slider value={p.exploration} min={0} max={0.3} step={0.05} onValueChange={(v) => update({ ...p, exploration: Math.round(v * 100) / 100 })} />
          </Host>
          <Text style={[text('body'), tabular, { fontSize: 17, color: colors.muted, width: 44, textAlign: 'right' }]}>
            {Math.round(p.exploration * 100)}%
          </Text>
        </View>
      </Section>
      <Section title="Banned words" footer="Listings with any of these words are hidden. Comma separated.">
        <TextInput
          value={banned}
          onChangeText={(v) => {
            setBanned(v);
            setDirty(true);
          }}
          multiline
          accessibilityLabel="Banned words"
          autoCapitalize="none"
          style={[text('body'), { fontSize: 17, color: colors.foreground, padding: 16, minHeight: 88, textAlignVertical: 'top' }]}
        />
      </Section>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced((a) => !a)} style={{ marginHorizontal: 32, marginBottom: 12 }}>
        <Text style={[text('footnote'), { color: colors.muted }]}>{advanced ? 'Hide score weights' : 'Advanced: score weights'}</Text>
      </Pressable>
      {advanced ? (
        <Section footer="How much each signal counts in the ranking. 0 switches one off.">
          {(Object.keys(weights) as (keyof Weights)[]).map((k) => (
            <Row
              key={k}
              label={k.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())}
              right={
                <TextInput
                  value={weights[k]}
                  onChangeText={(v) => {
                    setWeights({ ...weights, [k]: v });
                    setDirty(true);
                  }}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`${k} weight`}
                  style={[text('body'), tabular, { fontSize: 17, color: colors.foreground, width: 70, textAlign: 'right', marginLeft: 'auto', paddingVertical: 0 }]}
                />
              }
            />
          ))}
        </Section>
      ) : null}
      {save.isError ? <Text style={[text('footnote'), { color: colors.danger, marginHorizontal: 32 }]}>{(save.error as Error).message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  slider: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, minHeight: 52 },
});
