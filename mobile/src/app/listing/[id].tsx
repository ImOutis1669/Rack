// The listing sheet (the web's ListingSheet): photos, price and delivered cost, the action row,
// why it's here, details, description, and "Buy on ..." pinned at the bottom.
import { formatGBP, sellerLabel, SOURCE_LABEL, timeAgo } from '@rack/shared/format';
import { huntFromListing } from '@rack/shared/hunts';
import { landedLines, previousPrice } from '@rack/shared/landed';
import { safeHref } from '@rack/shared/safe';
import { sellerHide } from '@rack/shared/seller';
import { listingThumb, thumbWidthFor } from '@rack/shared/thumbs';
import type { Listing } from '@rack/shared/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Linking, PixelRatio, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { PhotoPager } from '@/components/PhotoPager';
import { ScoreRing } from '@/components/ScoreRing';
import { useToast } from '@/components/Toast';
import { VoteButtons } from '@/components/VoteButtons';
import { SOURCE_DOT } from '@/features/feed/options';
import { useListingActions } from '@/features/feed/useListingActions';
import { useSession } from '@/lib/auth';
import { shareListing } from '@/lib/share';
import { useTheme } from '@/theme/ThemeProvider';
import { font, tabular } from '@/theme/type';

const GALLERY_STALE_MS = 10 * 60_000; // as the web's lib/prefetch
const MEAS: [keyof Listing['measurements'], string][] = [
  ['inseam_cm', 'Inseam'],
  ['sleeve_cm', 'Sleeve'],
  ['p2p_cm', 'Pit to pit'],
  ['length_cm', 'Length'],
];

export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: item } = useQuery<Listing>({ queryKey: ['listing', Number(id)], enabled: false });
  const { colors, text } = useTheme();
  if (!item) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ headerShown: true, title: '' }} />
        <Text style={[text('body'), { color: colors.muted }]}>This listing isn't loaded. Open it from the feed.</Text>
      </View>
    );
  }
  return <ListingSheet item={item} />;
}

function ListingSheet({ item }: { item: Listing }) {
  const session = useSession();
  const api = session.api();
  const qc = useQueryClient();
  const toast = useToast();
  const { colors, text, scheme, customFont } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const actions = useListingActions(item);
  const medium = font('medium', customFont);

  const gallery = useQuery({
    queryKey: ['gallery', item.id],
    queryFn: () => api.gallery(item.id),
    staleTime: GALLERY_STALE_MS,
  });
  const images = gallery.data?.images.length ? gallery.data.images : item.images;
  const thumb = listingThumb(item, thumbWidthFor(width * PixelRatio.get() * 0.5));
  const firstPlaceholder = thumb?.startsWith('/')
    ? { uri: `${session.server}${thumb}`, headers: session.imageHeaders(), cacheKey: `${session.server}${thumb}` }
    : undefined;

  const was = previousPrice(item);
  const score = item.score != null ? Math.round(Math.max(0, Math.min(1, item.score)) * 100) : null;
  const reasons = (item.why ?? '').split(' · ').filter(Boolean);
  const meas = MEAS.filter(([k]) => item.measurements?.[k] != null);
  const seller = sellerLabel(item.seller?.rating ?? null, item.seller?.count ?? null);
  const hideSeller = sellerHide(item);
  const extra =
    gallery.data?.photo_count && gallery.data.photo_count > images.length ? gallery.data.photo_count - images.length : 0;

  const close = () => router.back();
  const huntForThis = () => {
    qc.setQueryData(['huntPrefill'], huntFromListing(item)); // the Hunts tab opens its form with it
    router.dismissTo('/hunts');
  };
  const hide = async (kind: 'seller' | 'brand', value: string) => {
    if (await actions.hide(kind, value)) close();
  };
  const buy = (url: string) => {
    const href = safeHref(url);
    if (!href) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // the marketplace's own app when it's installed (universal link), else Safari
    void Linking.openURL(href).catch(() => toast("Couldn't open the listing"));
  };

  const details: [string, string, boolean?][] = [
    ...(item.size ? ([['Size', item.size]] as [string, string][]) : []),
    ...(item.condition ? ([['Condition', item.condition]] as [string, string][]) : []),
    ...meas.map(([k, label]) => [label, `${Math.round(item.measurements[k]!)} cm`, true] as [string, string, boolean]),
    ...(item.seller?.name ? ([['Seller', `${item.seller.name}${seller ? ` · ${seller}` : ''}`]] as [string, string][]) : []),
    ...(item.country ? ([['Ships from', item.country]] as [string, string][]) : []),
  ];
  const footerHeight = item.buy_links.length * 58 + 16 + insets.bottom;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: true, title: item.brand ?? SOURCE_LABEL[item.source] ?? '' }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="xmark" accessibilityLabel="Close" onPress={close} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More" title="">
          {actions.saved ? (
            <Stack.Toolbar.MenuAction icon="bag" onPress={() => router.push({ pathname: '/bought/[id]', params: { id: String(item.id) } })}>
              I bought it
            </Stack.Toolbar.MenuAction>
          ) : null}
          {hideSeller?.available ? (
            <Stack.Toolbar.MenuAction icon="eye.slash" onPress={() => void hide('seller', hideSeller.name)}>
              {`Hide seller ${hideSeller.name}`}
            </Stack.Toolbar.MenuAction>
          ) : hideSeller ? (
            <Stack.Toolbar.MenuAction icon="eye.slash" disabled>
              {`Hide seller: ${hideSeller.reason}`}
            </Stack.Toolbar.MenuAction>
          ) : null}
          {item.brand ? (
            <Stack.Toolbar.MenuAction icon="eye.slash" onPress={() => void hide('brand', item.brand!)}>
              {`Hide ${item.brand}`}
            </Stack.Toolbar.MenuAction>
          ) : null}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <ScrollView contentContainerStyle={{ paddingBottom: footerHeight + 16 }}>
        <PhotoPager
          images={images}
          title={item.title}
          width={width}
          firstPlaceholder={firstPlaceholder}
          loading={gallery.isFetching && images.length <= 1}
        />
        <View style={styles.body}>
          <View style={styles.gap4}>
            <View style={styles.metaRow}>
              <View style={[styles.badge, { backgroundColor: colors.fill }]}>
                <View style={[styles.dot, { backgroundColor: SOURCE_DOT[item.source][scheme] }]} />
                <Text style={[text('caption'), medium, { color: colors.foreground }]}>{SOURCE_LABEL[item.source]}</Text>
              </View>
              <Text style={[text('caption'), { color: colors.muted }]}>{timeAgo(item.listed_at ?? item.first_seen_at)}</Text>
            </View>
            <Text accessibilityRole="header" style={[text('title'), { color: colors.foreground }]}>
              {item.title}
            </Text>
            <View style={styles.priceRow}>
              <Text style={[text('title'), font('bold', customFont), tabular, { fontSize: 26, color: colors.foreground }]}>
                {formatGBP(item.price_gbp)}
              </Text>
              {was != null ? (
                <Text
                  accessibilityLabel={`was ${formatGBP(was)}`}
                  style={[text('body'), tabular, { color: colors.muted, textDecorationLine: 'line-through' }]}>
                  {formatGBP(was)}
                </Text>
              ) : null}
            </View>
            {item.landed && (item.landed.imported || item.landed.notes.length > 0) ? (
              <Text style={[text('footnote'), { color: colors.muted }]}>
                {item.landed.imported ? (
                  <Text style={[medium, { color: colors.warning }]}>≈ {formatGBP(item.landed.total_gbp)} delivered (estimate). </Text>
                ) : null}
                {landedLines(item.landed).join(' · ')}
              </Text>
            ) : null}
          </View>

          <View style={styles.actions}>
            <VoteButtons vote={actions.vote} onVote={actions.castVote} />
            <RoundButton label={actions.saved ? 'Remove from saved' : 'Save'} selected={actions.saved} onPress={actions.toggleSave}>
              <Icon name="bookmark" filled={actions.saved} size={22} color={colors.foreground} />
            </RoundButton>
            {item.buy_links.length > 0 ? (
              <RoundButton label="Share" onPress={() => shareListing(item.buy_links, item.title, toast)}>
                <Icon name="share" size={22} color={colors.foreground} />
              </RoundButton>
            ) : null}
            <RoundButton label="Hunt for this" onPress={huntForThis}>
              <Icon name="hunts" size={22} color={colors.foreground} />
            </RoundButton>
          </View>

          {score != null || reasons.length > 0 ? (
            <View style={[styles.why, { backgroundColor: scheme === 'dark' ? colors.elevated : colors.surface }]}>
              {score != null ? <ScoreRing value={score} /> : null}
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[text('footnote'), medium, { color: colors.foreground }]}>{"Why it's here"}</Text>
                {reasons.map((r) => (
                  <Text key={r} style={[text('footnote'), { color: r.startsWith('⚠') ? colors.warning : colors.muted }]}>
                    {r.replace(/^⚠\s*/, '')}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}

          {details.length > 0 ? (
            <View style={styles.details}>
              {details.map(([label, value, num]) => (
                <View key={label} style={styles.detail}>
                  <Text style={[text('caption'), { color: colors.muted }]}>{label}</Text>
                  <Text numberOfLines={2} style={[text('footnote'), num ? tabular : null, { color: colors.foreground }]}>
                    {value}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {gallery.data?.description ? (
            <View style={styles.gap4}>
              <Text style={[text('footnote'), medium, { color: colors.foreground }]}>Description</Text>
              <Text selectable style={[text('footnote'), { color: colors.muted }]}>
                {gallery.data.description}
              </Text>
            </View>
          ) : null}
          {gallery.data?.note || extra > 0 ? (
            <Text style={[text('footnote'), { color: colors.muted }]}>
              {gallery.data?.note}
              {extra > 0 ? ` ${extra} more photo${extra === 1 ? ' is' : 's are'} only on ${SOURCE_LABEL[item.source]}.` : ''}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 8, backgroundColor: colors.background, borderTopColor: colors.border }]}>
        {item.buy_links.map((link, i) => {
          const primary = i === 0;
          const fg = primary ? colors.background : colors.foreground;
          return (
            <Pressable
              key={link.url}
              accessibilityRole="link"
              accessibilityLabel={`Buy on ${SOURCE_LABEL[link.source]}${link.size ? `, size ${link.size}` : ''}, ${formatGBP(link.price_gbp)}`}
              onPress={() => buy(link.url)}
              style={({ pressed }) => [
                styles.buy,
                { backgroundColor: primary ? colors.foreground : colors.fill, transform: [{ scale: pressed ? 0.97 : 1 }] },
              ]}>
              <View style={styles.buyLabel}>
                <Icon name="buy" size={18} color={fg} />
                <Text style={[text('headline'), { fontSize: 17, color: fg }]}>Buy on {SOURCE_LABEL[link.source]}</Text>
                {link.size ? <Text style={[text('body'), { color: fg, opacity: 0.6 }]}>· {link.size}</Text> : null}
              </View>
              <Text style={[text('headline'), tabular, { fontSize: 17, color: fg }]}>{formatGBP(link.price_gbp)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function RoundButton({ label, selected, onPress, children }: { label: string; selected?: boolean; onPress: () => void; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected != null ? { selected } : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.round, { backgroundColor: colors.fill, transform: [{ scale: pressed ? 0.9 : 1 }] }]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  body: { padding: 16, gap: 20 },
  gap4: { gap: 4 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 24, paddingHorizontal: 8, borderRadius: 12 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  why: { flexDirection: 'row', gap: 16, padding: 16, borderRadius: 16, borderCurve: 'continuous' },
  details: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  detail: { width: '50%', paddingRight: 16, gap: 2 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 8, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  buy: { height: 50, borderRadius: 25, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  buyLabel: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
});
