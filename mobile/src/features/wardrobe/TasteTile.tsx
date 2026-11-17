// Wardrobe / wishlist tile (the web's TasteTile): photo, brand, name, value with trend badge.
import { confidence } from '@rack/shared/wardrobeValue';
import { displayName, itemName, photoState, tileValue } from '@rack/shared/tasteItem';
import { thumbUrl, thumbWidthFor } from '@rack/shared/thumbs';
import { tileBadge } from '@rack/shared/trend';
import type { TasteItem } from '@rack/shared/types';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo } from 'react';
import { PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';

import { useSession } from '@/lib/auth';
import { apiImage } from '@/lib/images';
import { useTheme } from '@/theme/ThemeProvider';
import { font, tabular } from '@/theme/type';

export const TasteTile = memo(function TasteTile({ item, width }: { item: TasteItem; width: number }) {
  const session = useSession();
  const { colors, text, customFont } = useTheme();
  const value = tileValue(item);
  const badge = item.kind === 'wardrobe' ? tileBadge(item.trend) : null;
  const state = photoState(item);
  const rough = item.custom_value_gbp == null && item.estimate_gbp != null && confidence(item.estimate_count) === 'low';
  const thumb = item.thumb ? thumbUrl(item.thumb, thumbWidthFor(width * PixelRatio.get())) : item.image;
  const name = itemName(item);
  const badgeColor =
    badge?.direction === 'up' ? colors.accent : badge?.direction === 'down' ? colors.danger : colors.muted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[item.brand, displayName(item), value, badge?.text].filter(Boolean).join(', ')}
      onPress={() => router.push({ pathname: '/wardrobe/[id]', params: { id: String(item.id), kind: item.kind } })}
      style={({ pressed }) => ({ width, marginBottom: 20, transform: [{ scale: pressed ? 0.97 : 1 }] })}>
      <View style={[styles.photo, { backgroundColor: colors.fill }]}>
        {thumb ? (
          <Image source={apiImage(session, thumb)} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} recyclingKey={String(item.id)} />
        ) : (
          <View style={styles.textPhoto}>
            <Text style={[text('footnote'), font('medium', customFont), { color: colors.foreground, textAlign: 'center' }]}>
              “{displayName(item)}”
            </Text>
          </View>
        )}
        {state ? (
          <View style={[styles.state, { backgroundColor: colors.background + 'CC' }]}>
            <Text style={[text('caption'), font('medium', customFont), { color: item.embed_error ? colors.danger : colors.muted }]}>{state}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.textBlock}>
        {item.brand ? (
          <Text numberOfLines={1} style={[text('caption'), font('medium', customFont), styles.brand, { color: colors.muted }]}>
            {item.brand.toUpperCase()}
          </Text>
        ) : null}
        {name ? (
          <Text numberOfLines={1} style={[text('footnote'), { color: colors.foreground }]}>
            {name}
          </Text>
        ) : null}
        {value ? (
          <View style={styles.valueRow}>
            <Text style={[text('headline'), tabular, { color: colors.foreground }]}>{value}</Text>
            {rough ? <View accessibilityLabel="rough estimate" style={[styles.rough, { backgroundColor: colors.subtle }]} /> : null}
            {badge ? <Text style={[text('caption'), font('medium', customFont), tabular, { color: badgeColor }]}>{badge.text}</Text> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  photo: { aspectRatio: 4 / 5, borderRadius: 12, borderCurve: 'continuous', overflow: 'hidden' },
  textPhoto: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  state: { position: 'absolute', bottom: 6, left: 6, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  textBlock: { paddingTop: 8, gap: 1 },
  brand: { letterSpacing: 0.4 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 },
  rough: { width: 6, height: 6, borderRadius: 3, alignSelf: 'center' },
});
