import type { Listing } from '@rack/shared/types';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { ListingGrid } from '@/components/ListingGrid';
import { useSession } from '@/lib/auth';
import { getListingState, useHiddenIds } from '@/lib/listingState';
import { loadSnapshot, saveSnapshot } from '@/lib/storage';
import { useTheme } from '@/theme/ThemeProvider';

// Saved listings (the web's Saved page): the feed's grid, "I bought it" under each tile,
// pull to refresh, and the 24 h snapshot for instant start.
export default function SavedScreen() {
  const api = useSession().api();
  const { colors } = useTheme();
  const hidden = useHiddenIds();
  const q = useQuery({
    queryKey: ['saved'],
    queryFn: api.saved,
    staleTime: 0,
    placeholderData: () => loadSnapshot<Listing[]>('saved'),
  });
  // reload whenever the tab is shown (saves happen in the feed and the listing sheet)
  const { refetch } = q;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  useEffect(() => {
    if (q.data && !q.isPlaceholderData) saveSnapshot('saved', q.data);
  }, [q.data, q.isPlaceholderData]);
  // unsaved or bought in this session: gone at once, before the list reloads
  const items = useMemo(
    () => (q.data ?? []).filter((i) => !hidden.has(i.id) && getListingState(i.id)?.saved !== false),
    [q.data, hidden],
  );

  const empty = q.isError ? (
    <EmptyState
      icon="search"
      title="Couldn't load Saved"
      body={(q.error as Error).message}
      action={{ label: 'Try again', onPress: () => void q.refetch() }}
    />
  ) : q.isPending ? (
    <View style={{ paddingTop: 80, alignItems: 'center' }}>
      <ActivityIndicator color={colors.muted} />
    </View>
  ) : (
    <EmptyState
      icon="bookmark"
      title="Nothing saved yet"
      body="Tap the bookmark on a listing to keep it here. You'll get an alert if its price drops."
    />
  );

  return (
    <ListingGrid
      items={items}
      empty={empty}
      showBought
      refreshing={q.isRefetching && !q.isPlaceholderData}
      onRefresh={() => void q.refetch()}
    />
  );
}
