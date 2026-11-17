import { hideSeenSince } from '@rack/shared/fresh';
import { isDefaultFeed } from '@rack/shared/snapshot';
import { SeenBatcher } from '@rack/shared/seen';
import type { FeedPage, FeedParams } from '@rack/shared/types';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';

import { useSession } from '@/lib/auth';
import { recordFirstFeed } from '@/lib/perfStore';
import { useHiddenIds } from '@/lib/listingState';
import { loadSnapshot, saveSnapshot } from '@/lib/storage';

import { useFeedParams } from './FeedParams';

/** The ranked feed (the web's Feed page logic): visit, pages, instant-start snapshot, seen. */
export function useFeed() {
  const api = useSession().api();
  const { params, newOnly } = useFeedParams();
  const hiddenIds = useHiddenIds();

  const visit = useQuery({ queryKey: ['visit'], queryFn: api.visit, staleTime: Infinity });
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile });
  const refresh = useQuery({ queryKey: ['refresh'], queryFn: api.refreshStatus });

  const effective: FeedParams = {
    ...params,
    // from your latest Refresh on, what you've already seen stays hidden
    hideSeenBefore: hideSeenSince(visit.data?.visit_start, refresh.data),
    newSince: newOnly ? (visit.data?.last_visit ?? null) : null,
  };
  const query = useInfiniteQuery({
    queryKey: ['feed', effective],
    queryFn: ({ pageParam }) => api.feed(effective, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: visit.isSuccess || visit.isError,
    staleTime: Infinity, // the ranking must not reshuffle under you while scrolling
    // instant start: the last default feed (<= 24 h old) shows while this one loads
    placeholderData: () => {
      if (!isDefaultFeed(params, newOnly)) return undefined;
      const first = loadSnapshot<FeedPage>('feed');
      return first ? { pages: [first], pageParams: [null] } : undefined;
    },
  });
  const firstPage = query.isPlaceholderData ? undefined : query.data?.pages[0];
  useEffect(() => {
    if (query.data?.pages[0]) recordFirstFeed(); // snapshot or live, whichever shows first
  }, [query.data]);
  useEffect(() => {
    if (firstPage && isDefaultFeed(params, newOnly)) saveSnapshot('feed', firstPage);
  }, [firstPage, params, newOnly]);

  // "seen" ids go to the server in batches, and right away when the app goes to the background
  const batcher = useMemo(() => new SeenBatcher(api.seen), [api]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s !== 'active' && void batcher.flush());
    return () => {
      sub.remove();
      void batcher.flush();
    };
  }, [batcher]);
  const onSeen = useCallback((id: number) => batcher.add(id), [batcher]);

  const { hasNextPage, isFetchingNextPage, isPlaceholderData, fetchNextPage } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isPlaceholderData) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isPlaceholderData, fetchNextPage]);

  // couldn't load (offline, Tailscale off): keep showing the last default feed (<= 24 h) rather
  // than an empty error page; the banner says why
  const fallback = useMemo(
    () => (query.isError && !query.data && isDefaultFeed(params, newOnly) ? loadSnapshot<FeedPage>('feed') : undefined),
    [query.isError, query.data, params, newOnly],
  );
  const items = useMemo(
    () => (query.data?.pages.flatMap((p) => p.items) ?? fallback?.items ?? []).filter((i) => !hiddenIds.has(i.id)),
    [query.data, fallback, hiddenIds],
  );
  const needsSetup = profile.data && profile.data.designer_count === 0 && profile.data.taste_count === 0;
  return { query, items, loadMore, onSeen, needsSetup: Boolean(needsSetup), visit, showingSaved: Boolean(fallback) };
}
