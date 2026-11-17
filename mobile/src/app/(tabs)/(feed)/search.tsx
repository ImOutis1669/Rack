// Search across all sources (v2.1), pushed from the magnifying glass in the feed's header.
// Instant: everything Rack already has, as you type (native search bar). Live: "Search eBay,
// Vinted and Grailed now" asks each site once through the worker; results join as they arrive.
import { addRecent, cleanQuery, huntFromSearch, liveFinished, liveSummary } from '@rack/shared/search';
import { ApiError } from '@rack/shared/client';
import type { Listing, SearchParams, SearchSort, Source } from '@rack/shared/types';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { ListingGrid } from '@/components/ListingGrid';
import { useToast } from '@/components/Toast';
import { useSession } from '@/lib/auth';
import { kv } from '@/lib/storage';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/type';

const SORTS: [SearchSort, string][] = [
  ['best', 'Best match'],
  ['newest', 'Newest'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
];
const SOURCES: [Source, string][] = [
  ['ebay', 'eBay'],
  ['vinted', 'Vinted'],
  ['grailed', 'Grailed'],
];
const RECENT_KEY = 'rack.recentSearches';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function loadRecent(): string[] {
  try {
    const v: unknown = JSON.parse(kv.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

export default function SearchScreen() {
  const session = useSession();
  const api = session.api();
  const qc = useQueryClient();
  const toast = useToast();
  const { colors, text, customFont } = useTheme();
  const [typed, setTyped] = useState('');
  const [sort, setSort] = useState<SearchSort>('best');
  const [sources, setSources] = useState<Source[]>([]);
  const [recent, setRecent] = useState(loadRecent);
  const [liveId, setLiveId] = useState<number | null>(null);
  const q = cleanQuery(useDebounced(typed, 250));
  const params: SearchParams = useMemo(() => ({ q, sort, sources }), [q, sort, sources]);

  const results = useInfiniteQuery({
    queryKey: ['search', params],
    queryFn: ({ pageParam }) => api.search(params, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: !!q,
    staleTime: 30_000,
  });
  const live = useQuery({
    queryKey: ['live-search', liveId],
    queryFn: () => api.liveSearchStatus(liveId as number),
    enabled: liveId != null,
    refetchInterval: (query) => (liveFinished(query.state.data) ? false : 2000),
  });
  const liveDone = liveFinished(live.data);
  useEffect(() => {
    if (liveDone) void qc.invalidateQueries({ queryKey: ['search'] });
  }, [liveDone, qc]);
  useEffect(() => setLiveId(null), [q]);

  const remember = (value: string) => {
    const next = addRecent(recent, value);
    setRecent(next);
    kv.setItem(RECENT_KEY, JSON.stringify(next));
  };
  const startLive = useMutation({
    mutationFn: () => api.liveSearch(q),
    onSuccess: (s) => {
      setLiveId(s.id);
      qc.setQueryData(['live-search', s.id], s);
    },
    onError: (e) =>
      toast(
        e instanceof ApiError && e.status === 429 && e.retryAfter
          ? `You can search the marketplaces again in ${e.retryAfter} s`
          : e instanceof Error
            ? e.message
            : "Couldn't start the search",
      ),
  });
  const saveAsHunt = () => {
    qc.setQueryData(['huntPrefill'], huntFromSearch(params)); // the Hunts tab opens its form with it
    router.navigate('/hunts');
  };

  const instant = results.data?.pages.flatMap((p) => p.items) ?? [];
  const seen = new Set(instant.map((i) => i.id));
  const items: Listing[] = [...(live.data?.items ?? []).filter((i) => !seen.has(i.id)), ...instant];
  const running = liveId != null && !liveDone;
  const sortLabel = SORTS.find(([s]) => s === sort)?.[1] ?? 'Best match';

  const header = (
    <View style={styles.header}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {SOURCES.map(([s, label]) => (
          <Chip
            key={s}
            label={label}
            selected={sources.includes(s)}
            onPress={() => setSources((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))}
          />
        ))}
      </ScrollView>
      <View style={styles.liveRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: running || startLive.isPending }}
          disabled={running || startLive.isPending}
          onPress={() => {
            remember(typed);
            startLive.mutate();
          }}
          style={({ pressed }) => [
            styles.live,
            { backgroundColor: running ? colors.fill : colors.foreground, transform: [{ scale: pressed ? 0.97 : 1 }] },
          ]}>
          {running ? <ActivityIndicator size="small" color={colors.muted} /> : <Icon name="refresh" size={15} color={colors.background} />}
          <Text style={[text('footnote'), font('medium', customFont), { color: running ? colors.muted : colors.background }]}>
            {running ? 'Asking eBay, Vinted and Grailed' : liveDone ? 'Ask again' : 'Search eBay, Vinted and Grailed now'}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={saveAsHunt} style={styles.hunt} hitSlop={6}>
          <Text style={[text('footnote'), font('medium', customFont), { color: colors.foreground }]}>Save as hunt</Text>
        </Pressable>
      </View>
      {live.data && Object.keys(live.data.results).length ? (
        <Text accessibilityLiveRegion="polite" style={[text('footnote'), styles.summary, { color: colors.muted }]}>
          {liveDone ? `${live.data.items.length} found just now · ` : 'Found so far · '}
          {liveSummary(live.data)}
        </Text>
      ) : null}
    </View>
  );

  return (
    <>
      <Stack.SearchBar
        placeholder="Designers, items, sizes"
        autoFocus
        autoCapitalize="none"
        hideWhenScrolling={false}
        onChangeText={(e) => setTyped(e.nativeEvent.text)}
        onSearchButtonPress={(e) => remember(e.nativeEvent.text)}
        onCancelButtonPress={() => setTyped('')}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="arrow.up.arrow.down" accessibilityLabel={`Sort: ${sortLabel}`} title="Sort">
          {SORTS.map(([s, label]) => (
            <Stack.Toolbar.MenuAction key={s} isOn={sort === s} onPress={() => setSort(s)}>
              {label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      {!q ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" style={{ backgroundColor: colors.background }}>
          {recent.length ? (
            <View style={styles.recent}>
              <View style={styles.recentHead}>
                <Text style={[text('footnote'), { color: colors.muted }]}>RECENT</Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => {
                    setRecent([]);
                    kv.setItem(RECENT_KEY, '[]');
                  }}>
                  <Text style={[text('footnote'), { color: colors.muted }]}>Clear</Text>
                </Pressable>
              </View>
              {recent.map((r) => (
                <Pressable key={r} accessibilityRole="button" onPress={() => setTyped(r)} style={[styles.recentRow, { borderColor: colors.border }]}>
                  <Icon name="search" size={15} color={colors.muted} />
                  <Text style={[text('body'), { color: colors.foreground, fontSize: 17 }]}>{r}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <EmptyState
              icon="search"
              title="Search eBay, Vinted and Grailed"
              body="Everything Rack has found so far, as you type. Ask the sites directly when you need what was listed in the last few minutes."
            />
          )}
        </ScrollView>
      ) : (
        <ListingGrid
          items={items}
          header={header}
          empty={
            results.isPending || running ? (
              <ActivityIndicator style={{ marginTop: 48 }} color={colors.muted} />
            ) : results.isError ? (
              <EmptyState icon="search" title="Search isn't working right now" body={results.error instanceof Error ? results.error.message : undefined} />
            ) : (
              <EmptyState
                icon="search"
                title={`Nothing for "${q}" yet`}
                body="Ask the marketplaces directly, or save it as a hunt to hear when one turns up."
              />
            )
          }
          footer={results.isFetchingNextPage ? <ActivityIndicator style={{ paddingVertical: 16 }} color={colors.muted} /> : null}
          onEndReached={() => {
            if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  header: { gap: 10, paddingBottom: 16 },
  chips: { gap: 8, paddingHorizontal: 6 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, flexWrap: 'wrap' },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: 18 },
  hunt: { minHeight: 36, justifyContent: 'center' },
  summary: { paddingHorizontal: 6 },
  recent: { paddingHorizontal: 16, paddingTop: 8 },
  recentHead: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 4 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth },
});
