import { CATEGORIES, type Category, type Listing } from '@rack/shared/types';
import { laneGeometry } from '@rack/shared/grid';
import { FlashList, type ViewToken } from '@shopify/flash-list';
import { router, Stack } from 'expo-router';
import { useCallback, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { ListingTile } from '@/components/ListingTile';
import { useFeedParams } from '@/features/feed/FeedParams';
import { CATEGORY_LABEL, SORTS } from '@/features/feed/options';
import { useFeed } from '@/features/feed/useFeed';
import { useRefresh } from '@/features/feed/useRefresh';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/type';

const SIDE = 16;

export default function FeedScreen() {
  const { colors, text, customFont } = useTheme();
  const { params, setParams, filterCount } = useFeedParams();
  const { query, items, loadMore, onSeen, needsSetup } = useFeed();
  const { refresh, refreshing } = useRefresh();
  const { width } = useWindowDimensions();

  // 2 columns on iPhone (shared lane rules), 12 pt gap, 16 pt gutters
  const grid = laneGeometry(width - SIDE * 2);
  const cell = (width - SIDE * 2 + grid.gap) / grid.lanes;
  const tileWidth = cell - grid.gap;

  // a tile counts as seen after 1.2 s at least 60% on screen (the web's rule)
  const viewability = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 1200 }).current;
  const onViewable = useRef(({ changed }: { changed: ViewToken<Listing>[] }) => {
    for (const t of changed) if (t.isViewable && t.item) onSeenRef.current(t.item.id);
  }).current;
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;

  const renderItem = useCallback(
    ({ item }: { item: Listing }) => (
      <View style={{ paddingHorizontal: grid.gap / 2 }}>
        <ListingTile item={item} width={tileWidth} />
      </View>
    ),
    [tileWidth, grid.gap],
  );

  const sortLabel = SORTS.find(([s]) => s === params.sort)?.[1] ?? 'For you';
  const header = useMemo(
    () => (
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          accessibilityLabel="Categories">
          {(['any', ...CATEGORIES] as Category[]).map((c) => (
            <Chip
              key={c}
              label={CATEGORY_LABEL[c]}
              selected={(params.category ?? 'any') === c}
              onPress={() => setParams((p) => ({ ...p, category: c === 'any' ? null : c }))}
            />
          ))}
        </ScrollView>
        {needsSetup ? (
          <View style={[styles.setup, { backgroundColor: colors.surface }]}>
            <Text style={[text('headline'), { color: colors.foreground }]}>Teach Rack your taste</Text>
            <Text style={[text('footnote'), { color: colors.muted }]}>
              Add the designers you like and your measurements, then a few photos of clothes you own or want. Until
              then the feed is unranked.
            </Text>
            <View style={styles.setupButtons}>
              <Chip label="Designers and fit" selected onPress={() => router.push('/settings')} />
              <Chip label="Add photos" onPress={() => router.navigate('/wardrobe')} />
            </View>
          </View>
        ) : null}
      </View>
    ),
    [params.category, setParams, needsSetup, colors, text],
  );

  const empty = query.isError ? (
    <State title="Couldn't load the feed" body={(query.error as Error).message} action={{ label: 'Try again', onPress: () => void query.refetch() }} />
  ) : query.isPending ? (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.muted} />
    </View>
  ) : (
    <State
      title="You're all caught up"
      body="Sources are searched every 30 minutes, and things you've already seen stay hidden until your next visit. Pull down to search for new listings."
    />
  );

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="arrow.up.arrow.down" accessibilityLabel={`Sort: ${sortLabel}`} title="Sort">
          {SORTS.map(([s, label]) => (
            <Stack.Toolbar.MenuAction
              key={s}
              isOn={params.sort === s}
              onPress={() => setParams((p) => ({ ...p, sort: s }))}>
              {label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button
          icon="line.3.horizontal.decrease"
          accessibilityLabel={filterCount ? `Filters, ${filterCount} on` : 'Filters'}
          onPress={() => router.push('/filters')}>
          {filterCount ? <Stack.Toolbar.Badge>{String(filterCount)}</Stack.Toolbar.Badge> : null}
        </Stack.Toolbar.Button>
        <Stack.Toolbar.Button
          icon="gearshape"
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings')}
        />
      </Stack.Toolbar>
      <FlashList
        data={items}
        masonry
        numColumns={grid.lanes}
        keyExtractor={(i) => String(i.id)}
        renderItem={renderItem}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: SIDE - grid.gap / 2, paddingBottom: 24 }}
        style={{ backgroundColor: colors.background }}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <Text style={[text('footnote'), styles.more, { color: colors.muted }]}>Loading more</Text>
          ) : null
        }
        onEndReached={loadMore}
        onEndReachedThreshold={1.5}
        refreshing={refreshing}
        onRefresh={refresh}
        viewabilityConfig={viewability}
        onViewableItemsChanged={onViewable}
      />
    </>
  );

  function State({ title, body, action }: { title: string; body: string; action?: { label: string; onPress: () => void } }) {
    return (
      <View style={styles.state}>
        <Icon name="search" size={24} color={colors.muted} />
        <Text style={[text('title'), { color: colors.foreground, textAlign: 'center' }]}>{title}</Text>
        <Text style={[text('footnote'), { color: colors.muted, textAlign: 'center' }]}>{body}</Text>
        {action ? (
          <Pressable accessibilityRole="button" onPress={action.onPress} style={[styles.retry, { backgroundColor: colors.fill }]}>
            <Text style={[text('footnote'), font('medium', customFont), { color: colors.foreground }]}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  chips: { gap: 8, paddingHorizontal: 6, paddingBottom: 16 },
  setup: { marginHorizontal: 6, marginBottom: 20, padding: 20, borderRadius: 16, gap: 6, borderCurve: 'continuous' },
  setupButtons: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  loading: { paddingTop: 80, alignItems: 'center' },
  state: { paddingTop: 64, paddingHorizontal: 24, alignItems: 'center', gap: 8 },
  retry: { marginTop: 8, height: 44, paddingHorizontal: 18, borderRadius: 22, justifyContent: 'center' },
  more: { textAlign: 'center', paddingVertical: 16 },
});
