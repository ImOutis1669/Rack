import { SOURCE_LABEL } from '@rack/shared/format';
import { emptyHunt, INTERVALS, sizesHint } from '@rack/shared/hunts';
import { CATEGORY_LABEL } from '@rack/shared/tasteItem';
import { CATEGORIES, type Category, type HuntInput } from '@rack/shared/types';
import { splitList } from '@rack/shared/units';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { Field, Input, PrimaryButton, SwitchRow } from '@/components/Form';
import { SOURCES } from '@/features/feed/options';
import { useHunts } from '@/features/hunts/useHunts';
import { useSession } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';

// New / edit hunt (the web's HuntForm) as a native sheet. "Hunt for this" opens it pre-filled.
export default function HuntForm() {
  const { id, prefill } = useLocalSearchParams<{ id?: string; prefill?: string }>();
  const qc = useQueryClient();
  const hunts = useHunts();
  const existing = id ? hunts.data?.find((h) => h.id === Number(id)) : undefined;
  const [initial] = useState<HuntInput>(() => {
    if (existing) return existing;
    const fromListing = prefill ? qc.getQueryData<HuntInput>(['huntPrefill']) : undefined;
    qc.removeQueries({ queryKey: ['huntPrefill'] }); // used once
    return fromListing ?? emptyHunt();
  });
  if (id && !existing) return null;
  return <Form id={id ? Number(id) : null} initial={initial} />;
}

function Form({ id, initial }: { id: number | null; initial: HuntInput }) {
  const api = useSession().api();
  const qc = useQueryClient();
  const { colors, text } = useTheme();
  const [h, setH] = useState<HuntInput>(initial);
  const [sizes, setSizes] = useState(initial.sizes.join(', '));
  const set = <K extends keyof HuntInput>(k: K, v: HuntInput[K]) => setH((x) => ({ ...x, [k]: v }));
  const hasSizes = splitList(sizes).length > 0;

  const save = useMutation({
    mutationFn: () => {
      const list = splitList(sizes);
      const body: HuntInput = { ...h, name: h.name.trim() || h.query.trim(), sizes: list, strict_size: h.strict_size && list.length > 0 };
      return id == null ? api.createHunt(body) : api.updateHunt(id, body);
    },
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void qc.invalidateQueries({ queryKey: ['hunts'] });
      router.back();
    },
  });

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: id == null ? 'New hunt' : 'Edit hunt' }} />
      <Field label="Search for" hint="Every word must appear in the listing.">
        <Input value={h.query} onChangeText={(v) => set('query', v)} placeholder="rick owens geobasket" autoCorrect={false} autoCapitalize="none" autoFocus={id == null && !initial.query} />
      </Field>
      <Field label="Name">
        <Input value={h.name} onChangeText={(v) => set('name', v)} placeholder={h.query || 'Optional'} />
      </Field>
      <Field label="Category">
        <View style={styles.chips}>
          {(['any', ...CATEGORIES] as Category[]).map((c) => (
            <Chip key={c} label={CATEGORY_LABEL[c]} selected={h.category === c} onPress={() => set('category', c)} />
          ))}
        </View>
      </Field>
      <View style={styles.pair}>
        <View style={{ flex: 1 }}>
          <Field label="Max price (£)">
            <Input
              numeric
              keyboardType="number-pad"
              placeholder="Any"
              value={h.max_price_gbp == null ? '' : String(h.max_price_gbp)}
              onChangeText={(v) => set('max_price_gbp', v.trim() ? Number(v.replace(/[^0-9]/g, '')) || null : null)}
            />
          </Field>
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Sizes" hint={sizesHint(h.strict_size && hasSizes, hasSizes)}>
            <Input value={sizes} onChangeText={setSizes} placeholder="43, UK 9" autoCorrect={false} />
          </Field>
        </View>
      </View>
      <SwitchRow
        label="Size must match"
        value={h.strict_size && hasSizes}
        disabled={!hasSizes}
        onChange={(v) => hasSizes && set('strict_size', v)}
      />
      <Field label="Check">
        <View style={styles.chips}>
          {INTERVALS.map(([m, label]) => (
            <Chip key={m} label={label[0]!.toUpperCase() + label.slice(1)} selected={h.interval_minutes === m} onPress={() => set('interval_minutes', m)} />
          ))}
        </View>
      </Field>
      <Field label="Sources" hint="None selected searches all free sources.">
        <View style={styles.chips}>
          {SOURCES.map((s) => (
            <Chip
              key={s}
              label={SOURCE_LABEL[s]!}
              selected={h.sources.includes(s)}
              onPress={() => set('sources', h.sources.includes(s) ? h.sources.filter((x) => x !== s) : [...h.sources, s])}
            />
          ))}
        </View>
      </Field>
      <View style={[styles.group, { backgroundColor: colors.surface }]}>
        <SwitchRow label="Send alerts" value={h.notify} onChange={(v) => set('notify', v)} />
        <SwitchRow label="Active" value={h.enabled} onChange={(v) => set('enabled', v)} />
        <View style={styles.minRow}>
          <Text style={[text('body'), { fontSize: 17, color: colors.foreground, flex: 1 }]}>Minimum match</Text>
          <Input
            numeric
            keyboardType="number-pad"
            placeholder="Off"
            accessibilityLabel="Minimum match percent"
            value={h.min_score == null ? '' : String(Math.round(h.min_score * 100))}
            onChangeText={(v) => {
              const n = Number(v.replace(/[^0-9]/g, ''));
              set('min_score', v.trim() ? Math.min(100, n) / 100 : null);
            }}
            style={styles.minInput}
          />
          <Text style={[text('footnote'), { color: colors.muted }]}>%</Text>
        </View>
      </View>
      <Text style={[text('caption'), { color: colors.muted }]}>
        {"The first run only records what's already listed; you're alerted to new matches after that. Hidden sellers, banned words and fit rules still apply."}
      </Text>
      {save.isError ? <Text style={[text('footnote'), { color: colors.danger }]}>{(save.error as Error).message}</Text> : null}
      <PrimaryButton
        label={id == null ? 'Create hunt' : 'Save changes'}
        disabled={h.query.trim().length < 2 || save.isPending}
        onPress={() => save.mutate()}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 20, paddingBottom: 40 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pair: { flexDirection: 'row', gap: 12 },
  group: { borderRadius: 16, paddingHorizontal: 16, paddingVertical: 4, borderCurve: 'continuous' },
  minRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52 },
  minInput: { width: 80, textAlign: 'right', backgroundColor: 'transparent' },
});
