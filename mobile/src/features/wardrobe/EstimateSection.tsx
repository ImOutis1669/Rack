// The item sheet's estimate (with its closest matches) and the sold-price trend (the web's
// EstimateSection). Wardrobe items only.
import { formatGBP, SOURCE_LABEL } from '@rack/shared/format';
import { safeHref } from '@rack/shared/safe';
import { signedPct, type WindowDays, windowText } from '@rack/shared/trend';
import type { TasteItem } from '@rack/shared/types';
import { estimateText } from '@rack/shared/wardrobeValue';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Segmented } from '@/components/Segmented';
import { Sparkline } from '@/components/Sparkline';
import { useSession } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';
import { font, tabular } from '@/theme/type';

export function EstimateSection({ item }: { item: TasteItem }) {
  const api = useSession().api();
  const { colors, text, customFont } = useTheme();
  const { width } = useWindowDimensions();
  const [days, setDays] = useState<WindowDays>('30');
  const comps = useQuery({
    queryKey: ['comparables', item.id, item.estimate_at],
    queryFn: () => api.comparables(item.id),
    enabled: item.estimate_gbp != null,
  });
  if (item.kind !== 'wardrobe') return null;
  const heading = [text('footnote'), font('medium', customFont), { color: colors.muted }];
  const compWidth = (width - 32 - 16) / 3;
  const w = item.trend?.[days];

  return (
    <>
      <View style={styles.section} accessibilityLabel="Estimate">
        <Text style={heading}>Estimated value</Text>
        <Text style={[text('footnote'), { color: colors.foreground }]}>{estimateText(item)}</Text>
        {comps.data && comps.data.length > 0 ? (
          <View style={styles.comps}>
            {comps.data.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="link"
                accessibilityLabel={`${c.title}, ${formatGBP(c.price_gbp)}`}
                onPress={() => {
                  const href = safeHref(c.url);
                  if (href) void Linking.openURL(href);
                }}
                style={({ pressed }) => ({ width: compWidth, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
                {c.image ? (
                  <Image source={{ uri: c.image }} style={[styles.comp, { width: compWidth, height: compWidth, backgroundColor: colors.fill }]} contentFit="cover" />
                ) : (
                  <View style={[styles.comp, { width: compWidth, height: compWidth, backgroundColor: colors.fill }]} />
                )}
                <Text numberOfLines={1} style={[text('caption'), { color: colors.muted, marginTop: 4 }]}>
                  <Text style={[font('medium', customFont), tabular, { color: colors.foreground }]}>{formatGBP(c.price_gbp)}</Text>
                  {' · '}
                  {c.sold_at
                    ? `sold ${new Date(c.sold_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                    : SOURCE_LABEL[c.source]}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      {item.trend ? (
        <View style={styles.section} accessibilityLabel="Sold-price trend">
          <View style={styles.trendHead}>
            <Text style={heading}>Sold-price trend</Text>
            <View style={{ width: 180 }}>
              <Segmented
                label="Trend window"
                value={days}
                onChange={setDays}
                options={[
                  ['30', '30 days'],
                  ['90', '90 days'],
                ]}
              />
            </View>
          </View>
          {w ? (
            <Text
              style={[
                text('title'),
                font('bold', customFont),
                tabular,
                { color: w.direction === 'up' ? colors.accent : w.direction === 'down' ? colors.danger : colors.foreground },
              ]}>
              {signedPct(w.pct)}
            </Text>
          ) : null}
          <Text style={[text('footnote'), { color: colors.muted }]}>{windowText(item.trend, days)}</Text>
          <Sparkline points={item.trend.points} width={width - 32} />
          <Text style={[text('caption'), { color: colors.muted }]}>
            Grailed sales, mostly in the US, converted to £. Treat it as a rough signal.
          </Text>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  comps: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  comp: { borderRadius: 12, borderCurve: 'continuous' },
  trendHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
});
