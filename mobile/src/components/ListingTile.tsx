// Photo-first tile (the web's ListingTile): photo, brand, title, price, one line of meta.
// Tap opens the listing; long-press opens a native menu (save, upvote, downvote).
import { formatGBP, SOURCE_LABEL } from '@rack/shared/format';
import { landedLabel, previousPrice } from '@rack/shared/landed';
import { listingThumb, thumbWidthFor } from '@rack/shared/thumbs';
import type { Listing } from '@rack/shared/types';
import { useQueryClient } from '@tanstack/react-query';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { memo, type ReactNode } from 'react';
import { PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native';

import { SOURCE_DOT } from '@/features/feed/options';
import { useListingActions } from '@/features/feed/useListingActions';
import { useSession } from '@/lib/auth';
import { font, tabular } from '@/theme/type';
import { useTheme } from '@/theme/ThemeProvider';

import { Icon } from './Icon';

const GLASS = isLiquidGlassAvailable();

/** Glass on photos (navigation-layer overlay, DESIGN.md "Glass"); a soft fill before iOS 26. */
function Overlay({ style, children }: { style?: object; children: ReactNode }) {
  const { scheme } = useTheme();
  if (GLASS) return <GlassView style={[styles.overlay, style]} glassEffectStyle="regular">{children}</GlassView>;
  const bg = scheme === 'dark' ? 'rgba(28,28,30,0.72)' : 'rgba(255,255,255,0.78)';
  return <View style={[styles.overlay, style, { backgroundColor: bg }]}>{children}</View>;
}

interface Props {
  item: Listing;
  width: number;
}

export const ListingTile = memo(function ListingTile({ item, width }: Props) {
  const session = useSession();
  const qc = useQueryClient();
  const { colors, scheme, text, customFont } = useTheme();
  const medium = font('medium', customFont);
  const actions = useListingActions(item);

  const thumb = listingThumb(item, thumbWidthFor(width * PixelRatio.get()));
  const uri = thumb && thumb.startsWith('/') ? `${session.server}${thumb}` : thumb;
  const was = previousPrice(item);
  const copies = item.buy_links.length;
  const meta = [item.size && `Size ${item.size}`, landedLabel(item.landed), copies > 1 && `${copies} listings`]
    .filter(Boolean)
    .join(' · ');
  const price = formatGBP(item.price_gbp);

  return (
    <View style={{ width, marginBottom: 20 }}>
      <Link
        href={{ pathname: '/listing/[id]', params: { id: String(item.id) } }}
        asChild
        // the sheet reads the listing from the cache instead of fetching it again
        onPress={() => qc.setQueryData(['listing', item.id], item)}>
        <Link.Trigger>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={[item.brand, item.title, price, SOURCE_LABEL[item.source]].filter(Boolean).join(', ')}
            accessibilityHint="Opens the listing. Long-press for save and votes."
            style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}>
            <View style={[styles.photo, { backgroundColor: colors.fill }]}>
              {uri ? (
                <Image
                  source={{ uri, headers: session.imageHeaders(), cacheKey: uri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  transition={150}
                  recyclingKey={String(item.id)}
                  accessible={false}
                />
              ) : null}
              <Overlay style={styles.badge}>
                <View style={[styles.dot, { backgroundColor: SOURCE_DOT[item.source][scheme] }]} />
                <Text style={[text('caption'), medium, { color: colors.foreground }]}>
                  {SOURCE_LABEL[item.source] ?? item.source}
                </Text>
              </Overlay>
              {was != null ? (
                <Overlay style={styles.cut}>
                  <Text style={[text('caption'), medium, { color: colors.accent }]}>Price cut</Text>
                </Overlay>
              ) : null}
            </View>
            <View style={styles.textBlock}>
              {item.brand ? (
                <Text numberOfLines={1} style={[text('caption'), medium, styles.brand, { color: colors.muted }]}>
                  {item.brand.toUpperCase()}
                </Text>
              ) : null}
              <Text numberOfLines={1} style={[text('footnote'), { color: colors.foreground }]}>
                {item.title}
              </Text>
              <View style={styles.priceRow}>
                <Text style={[text('headline'), tabular, { color: colors.foreground }]}>{price}</Text>
                {was != null ? (
                  <Text style={[text('caption'), tabular, styles.was, { color: colors.muted }]}>{formatGBP(was)}</Text>
                ) : null}
              </View>
              {meta ? (
                <Text numberOfLines={1} style={[text('caption'), { color: colors.muted }]}>
                  {meta}
                </Text>
              ) : null}
            </View>
          </Pressable>
        </Link.Trigger>
        <Link.Menu>
          <Link.MenuAction icon={actions.saved ? 'bookmark.fill' : 'bookmark'} onPress={actions.toggleSave}>
            {actions.saved ? 'Remove from saved' : 'Save'}
          </Link.MenuAction>
          <Link.MenuAction
            icon={actions.vote === 1 ? 'arrowshape.up.fill' : 'arrowshape.up'}
            isOn={actions.vote === 1}
            onPress={() => actions.castVote(1)}>
            More like this
          </Link.MenuAction>
          <Link.MenuAction
            icon={actions.vote === -1 ? 'arrowshape.down.fill' : 'arrowshape.down'}
            isOn={actions.vote === -1}
            onPress={() => actions.castVote(-1)}>
            Less like this
          </Link.MenuAction>
        </Link.Menu>
      </Link>
      {/* save stays one tap away, like the web's bookmark on the photo */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actions.saved ? 'Remove from saved' : 'Save'}
        accessibilityState={{ selected: actions.saved }}
        hitSlop={6}
        onPress={actions.toggleSave}
        style={({ pressed }) => [styles.save, { transform: [{ scale: pressed ? 0.9 : 1 }] }]}>
        <Overlay style={styles.saveInner}>
          <Icon name="bookmark" filled={actions.saved} size={17} color={colors.foreground} />
        </Overlay>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  photo: { aspectRatio: 4 / 5, borderRadius: 12, borderCurve: 'continuous', overflow: 'hidden' },
  overlay: { borderRadius: 999, overflow: 'hidden', flexDirection: 'row', alignItems: 'center' },
  badge: { position: 'absolute', top: 8, left: 8, height: 24, paddingHorizontal: 8, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  cut: { position: 'absolute', bottom: 8, left: 8, height: 22, paddingHorizontal: 8 },
  save: { position: 'absolute', top: 2, right: 2, padding: 2 },
  saveInner: { width: 36, height: 36, justifyContent: 'center' },
  textBlock: { paddingTop: 8, gap: 1 },
  brand: { letterSpacing: 0.4 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 },
  was: { textDecorationLine: 'line-through' },
});
