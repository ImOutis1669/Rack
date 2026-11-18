import type { Designer, DesignerWeight } from '@rack/shared/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { designersToSave } from '@/features/settings/profileForm';
import { SaveButton, useAfterTasteSave } from '@/features/settings/useProfile';
import { useSession } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/type';

const WEIGHTS: [DesignerWeight, string][] = [
  ['love', 'Love'],
  ['like', 'Like'],
  ['curious', 'Curious'],
  ['exclude', 'Never'],
];
const LABEL = Object.fromEntries(WEIGHTS) as Record<DesignerWeight, string>;

export default function DesignersPage() {
  const api = useSession().api();
  const { colors } = useTheme();
  const designers = useQuery({ queryKey: ['designers'], queryFn: api.designers });
  const adjacent = useQuery({ queryKey: ['adjacent'], queryFn: api.adjacent });
  if (!designers.data || !adjacent.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: 60 }}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }
  return <DesignersForm initial={designers.data} adjacent={adjacent.data} />;
}

function DesignersForm({ initial, adjacent }: { initial: Designer[]; adjacent: Record<string, string[]> }) {
  const api = useSession().api();
  const done = useAfterTasteSave();
  const { colors, text, customFont } = useTheme();
  const [ds, setDs] = useState<Designer[]>(initial);
  const [adj, setAdj] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(adjacent).map(([k, v]) => [k, v.join(', ')])),
  );
  const [dirty, setDirty] = useState(false);
  const change = (next: Designer[]) => {
    setDs(next);
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: async () => {
      const first = designersToSave(ds, adj, {});
      await api.saveDesigners(first.designers);
      const seeded = await api.adjacent(); // includes freshly suggested similar designers
      await api.saveAdjacent(designersToSave(ds, adj, seeded).adjacent);
    },
    onSuccess: () => {
      setDirty(false);
      done();
    },
  });

  const pickWeight = (i: number) =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: ds[i]!.name || 'Designer',
        options: [...WEIGHTS.map(([, l]) => l), 'Cancel'],
        cancelButtonIndex: WEIGHTS.length,
        destructiveButtonIndex: 3,
      },
      (j) => {
        if (j < WEIGHTS.length) change(ds.map((d, k) => (k === i ? { ...d, weight: WEIGHTS[j]![0] } : d)));
      },
    );

  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <SaveButton dirty={dirty} pending={save.isPending} onPress={() => save.mutate()} />
      <View style={[styles.box, { backgroundColor: colors.surface }]}>
        {ds.map((d, i) => (
          <View key={i} style={[styles.row, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : null]}>
            <View style={styles.line}>
              <TextInput
                value={d.name}
                onChangeText={(v) => change(ds.map((x, k) => (k === i ? { ...x, name: v } : x)))}
                placeholder="Designer name"
                placeholderTextColor={colors.subtle}
                accessibilityLabel="Designer"
                autoCorrect={false}
                style={[text('body'), { fontSize: 17, color: colors.foreground, flex: 1, paddingVertical: 0 }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`How much you like them: ${LABEL[d.weight]}`}
                onPress={() => pickWeight(i)}
                style={[
                  styles.weight,
                  { backgroundColor: d.weight === 'love' ? colors.foreground : colors.fill },
                ]}>
                <Text
                  style={[
                    text('footnote'),
                    font('medium', customFont),
                    { color: d.weight === 'love' ? colors.background : d.weight === 'exclude' ? colors.danger : colors.foreground },
                  ]}>
                  {LABEL[d.weight]}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${d.name || 'designer'}`}
                hitSlop={8}
                onPress={() => change(ds.filter((_, k) => k !== i))}>
                <Icon name="close" size={16} color={colors.muted} />
              </Pressable>
            </View>
            {(d.weight === 'love' || d.weight === 'like') && adj[d.name] !== undefined ? (
              <TextInput
                value={adj[d.name]}
                onChangeText={(v) => {
                  setAdj({ ...adj, [d.name]: v });
                  setDirty(true);
                }}
                placeholder="Also search: similar designers, comma separated"
                placeholderTextColor={colors.subtle}
                accessibilityLabel={`Designers similar to ${d.name}`}
                style={[text('footnote'), { color: colors.muted, paddingVertical: 0, marginTop: 4 }]}
              />
            ) : null}
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={() => change([...ds, { name: '', weight: 'love' }])}
          style={[styles.add, ds.length ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border } : null]}>
          <Icon name="plus" size={18} color={colors.accent} />
          <Text style={[text('body'), font('medium', customFont), { fontSize: 17, color: colors.accent }]}>Add designer</Text>
        </Pressable>
      </View>
      <Text style={[text('footnote'), { color: colors.muted, paddingHorizontal: 16 }]}>
        Love, like and curious only ever lift a listing; unbranded pieces are never pushed down. Never hides a designer
        completely. Loved and liked designers get suggested similar ones after you save.
      </Text>
      {save.isError ? <Text style={[text('footnote'), { color: colors.danger }]}>{(save.error as Error).message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 8, paddingBottom: 40 },
  box: { borderRadius: 16, overflow: 'hidden', borderCurve: 'continuous' },
  row: { paddingHorizontal: 16, paddingVertical: 10 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 },
  weight: { minHeight: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center' },
  add: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 16 },
});
