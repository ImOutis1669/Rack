import { formatGBP } from '@rack/shared/format';
import type { TasteItem } from '@rack/shared/types';
import { changeLabel, coverageLine, wardrobeTotals } from '@rack/shared/wardrobeValue';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { font, tabular } from '@/theme/type';

/** Wardrobe header (the web's WardrobeSummary): worth now, the change, what you paid. */
export function WardrobeSummary({ items }: { items: TasteItem[] }) {
  const { colors, text, customFont } = useTheme();
  const t = wardrobeTotals(items);
  if (t.valued + t.estimated + t.atPaid === 0) {
    return (
      <Text style={[text('footnote'), styles.wrap, { color: colors.muted }]}>
        Open an item to add what you paid or its brand, and its value shows here.
      </Text>
    );
  }
  const change = changeLabel(t);
  const up = (t.changePence ?? 0) > 0;
  const down = (t.changePence ?? 0) < 0;
  return (
    <View style={styles.wrap} accessible accessibilityLabel={`Worth now ${formatGBP(Math.round(t.worthPence / 100))}${change ? `, ${change}` : ''}`}>
      <Text style={[text('footnote'), { color: colors.muted }]}>Worth now</Text>
      <View style={styles.row}>
        <Text style={[text('largeTitle'), font('bold', customFont), tabular, { color: colors.foreground }]}>
          {formatGBP(Math.round(t.worthPence / 100))}
        </Text>
        {change ? (
          <Text style={[text('footnote'), font('medium', customFont), tabular, { color: up ? colors.accent : down ? colors.danger : colors.muted }]}>
            {change}
          </Text>
        ) : null}
      </View>
      <Text style={[text('caption'), { color: colors.muted }]}>
        {t.changePence != null ? `Paid ${formatGBP(t.paidPence / 100)} · ` : ''}
        {coverageLine(t)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 20, paddingHorizontal: 6 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
});
