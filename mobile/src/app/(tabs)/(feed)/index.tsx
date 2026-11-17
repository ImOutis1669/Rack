import { isDefaultFeed } from '@rack/shared/snapshot';
import { CATEGORIES, type Category } from '@rack/shared/types';
import { router, Stack } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { HeaderButtons } from '@/components/HeaderButtons';
import { Icon } from '@/components/Icon';
import { StatusBanner } from '@/components/StatusBanner';
import { ListingGrid } from '@/components/ListingGrid';
import { useFeedParams } from '@/features/feed/FeedParams';
import { NewForYou } from '@/features/feed/NewForYou';
import { CATEGORY_LABEL, SORTS } from '@/features/feed/options';
import { useFeed } from '@/features/feed/useFeed';
import { useRefresh } from '@/features/feed/useRefresh';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/type';

export default function FeedScreen() {
  const { colors, text, customFont } = useTheme();
  const { params, setParams, filterCount, newOnly } = useFeedParams();
  const defaultFeed = isDefaultFeed(params, newOnly);
  const { query, items, loadMore, onSeen, needsSetup, showingSaved } = useFeed();
  const { refresh, refreshing } = useRefresh();

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
        <StatusBanner error={query.isError ? query.error : null} showingSaved={showingSaved} />
        {needsSetup ? (
          <View style={[styles.setup, { backgroundColor: colors.surface }]}>
            <Text style={[text('headline'), { color: colors.foreground }]}>Teach Rack your taste</Text>
            <Text style={[text('footnote'), { color: colors.muted }]}>
              Add the designers you like and your measurements, then a few photos of clothes you own or want. Until
              then the feed is unranked.
            </Text>
            <View style={styles.setupButtons}>
              <Chip label="Designers and fit" selected onPress={() => router.push('/profile/settings')} />
              <Chip label="Add photos" onPress={() => router.navigate('/wardrobe')} />
            </View>
          </View>
        ) : null}
        {defaultFeed ? <NewForYou /> : null}
      </View>
    ),
    [params.category, setParams, needsSetup, colors, text, query.isError, query.error, showingSaved, defaultFeed],
  );

  const empty = query.isError ? (
    <State title="Couldn't load the feed" body="Nothing saved from the last 24 hours to show instead." action={{ label: 'Try again', onPress: () => void query.refetch() }} />
  ) : query.isPending ? (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.muted} />
    </View>
  ) : (
    <State
      title="You're all caught up"
      body="Sources are searched every 30 minutes, and things you've already seen stay hidden. Pull down to search your designers now."
    />
  );

  return (
    <>
      <HeaderButtons title="Rack">
        <Stack.Toolbar.Button icon="magnifyingglass" accessibilityLabel="Search" onPress={() => router.push('/search')} />
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
      </HeaderButtons>
      <ListingGrid
        items={items}
        header={header}
        empty={empty}
        footer={
          query.isFetchingNextPage ? (
            <Text style={[text('footnote'), styles.more, { color: colors.muted }]}>Loading more</Text>
          ) : null
        }
        onEndReached={loadMore}
        refreshing={refreshing}
        onRefresh={refresh}
        onSeen={onSeen}
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
  retry: { marginTop: 8, minHeight: 44, paddingHorizontal: 18, borderRadius: 22, justifyContent: 'center' },
  more: { textAlign: 'center', paddingVertical: 16 },
});
