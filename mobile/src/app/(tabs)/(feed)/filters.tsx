import { SOURCE_LABEL } from '@rack/shared/format';
import type { Visit } from '@rack/shared/types';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { useFeedParams } from '@/features/feed/FeedParams';
import { SOURCES } from '@/features/feed/options';
import { useTheme } from '@/theme/ThemeProvider';
import { font, tabular } from '@/theme/type';

// The feed's Filters sheet (a native form sheet with a grabber; swipe down to close).
export default function FiltersSheet() {
  const { colors, text, customFont } = useTheme();
  const { params, setParams, newOnly, setNewOnly, clearFilters } = useFeedParams();
  const visit = useQuery<Visit>({ queryKey: ['visit'], enabled: false });
  const canNewOnly = Boolean(visit.data?.last_visit);

  const label = [text('footnote'), font('medium', customFont), { color: colors.muted }];
  const input = [styles.input, text('body'), { fontSize: 17, color: colors.foreground, backgroundColor: colors.surface }];
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" style={{ backgroundColor: colors.background }}>
      <View style={styles.group}>
        <Text style={label}>Sources</Text>
        <View style={styles.row}>
          {SOURCES.map((s) => (
            <Chip
              key={s}
              label={SOURCE_LABEL[s]}
              selected={params.sources.includes(s)}
              onPress={() =>
                setParams((p) => ({
                  ...p,
                  sources: p.sources.includes(s) ? p.sources.filter((x) => x !== s) : [...p.sources, s],
                }))
              }
            />
          ))}
        </View>
        <Text style={[text('caption'), { color: colors.muted }]}>None selected shows every source.</Text>
      </View>
      <View style={styles.pair}>
        <View style={styles.half}>
          <Text style={label}>Brand</Text>
          <TextInput
            style={input}
            placeholder="Any"
            placeholderTextColor={colors.subtle}
            value={params.brand ?? ''}
            onChangeText={(v) => setParams((p) => ({ ...p, brand: v }))}
            autoCorrect={false}
            accessibilityLabel="Brand"
          />
        </View>
        <View style={styles.half}>
          <Text style={label}>Max price (£)</Text>
          <TextInput
            style={[input, tabular]}
            placeholder="Any"
            placeholderTextColor={colors.subtle}
            keyboardType="number-pad"
            value={params.maxPrice == null ? '' : String(params.maxPrice)}
            onChangeText={(v) => {
              const n = Number(v.replace(/[^0-9]/g, ''));
              setParams((p) => ({ ...p, maxPrice: v.trim() && Number.isFinite(n) ? n : null }));
            }}
            accessibilityLabel="Maximum price in pounds"
          />
        </View>
      </View>
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={[text('body'), { fontSize: 17, color: colors.foreground }]}>New since last visit</Text>
          <Text style={[text('footnote'), { color: colors.muted }]}>
            {canNewOnly ? 'Only items found since you were last here.' : 'Available after your next visit.'}
          </Text>
        </View>
        <Switch
          value={newOnly}
          disabled={!canNewOnly}
          onValueChange={setNewOnly}
          accessibilityLabel="New since last visit"
        />
      </View>
      <View style={styles.buttons}>
        <Pressable accessibilityRole="button" onPress={clearFilters} style={[styles.button, { backgroundColor: colors.fill }]}>
          <Text style={[text('headline'), { fontSize: 17, color: colors.foreground }]}>Clear</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={[styles.button, { backgroundColor: colors.foreground }]}>
          <Text style={[text('headline'), { fontSize: 17, color: colors.background }]}>Show results</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 24 },
  group: { gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pair: { flexDirection: 'row', gap: 12 },
  half: { flex: 1, gap: 8 },
  input: { height: 44, borderRadius: 12, paddingHorizontal: 12, borderCurve: 'continuous' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  buttons: { flexDirection: 'row', gap: 8 },
  button: { flex: 1, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
});
