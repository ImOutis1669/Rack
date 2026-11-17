import { isDefaultFeed } from '@rack/shared/snapshot';
import { SeenBatcher } from '@rack/shared/seen';
import type { FeedPage, FeedParams } from '@rack/shared/types';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { useSession } from '@/lib/auth';
import { loadSnapshot, saveSnapshot } from '@/lib/storage';

import { useFeedParams } from './FeedParams';

/** The ranked feed (the web's Feed page logic): visit, pages, instant-start snapshot, seen. */
export function useFeed() {
  const api = useSession().api();
  const { params, newOnly } = useFeedParams();
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());

  const visit = useQuery({ queryKey: ['visit'], queryFn: api.visit, staleTime: Infinity });
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile });

  const effective: FeedParams = {
    ...params,
    hideSeenBefore: visit.data?.visit_start ?? null,
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
  const onHidden = useCallback((id: number) => setHiddenIds((s) => new Set(s).add(id)), []);

  const { hasNextPage, isFetchingNextPage, isPlaceholderData, fetchNextPage } = query;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage && !isPlaceholderData) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isPlaceholderData, fetchNextPage]);

  const items = useMemo(
    () => (query.data?.pages.flatMap((p) => p.items) ?? []).filter((i) => !hiddenIds.has(i.id)),
    [query.data, hiddenIds],
  );
  const needsSetup = profile.data && profile.data.designer_count === 0 && profile.data.taste_count === 0;
  return { query, items, loadMore, onSeen, onHidden, needsSetup: Boolean(needsSetup), visit };
}
