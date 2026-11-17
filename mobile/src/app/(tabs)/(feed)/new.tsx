// "Show all" from the feed's New for you strip: every strong new find of your latest Refresh.
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { ListingGrid } from '@/components/ListingGrid';
import { useSession } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';

export default function NewForYouScreen() {
  const api = useSession().api();
  const { colors } = useTheme();
  const fresh = useQuery({ queryKey: ['feed', 'fresh', 'all'], queryFn: () => api.fresh(60) });
  return (
    <ListingGrid
      items={fresh.data?.items ?? []}
      empty={
        fresh.isPending ? (
          <ActivityIndicator style={{ marginTop: 48 }} color={colors.muted} />
        ) : (
          <EmptyState icon="refresh" title="Nothing new yet" body="Pull down on the feed to search your designers now." />
        )
      }
      refreshing={fresh.isRefetching}
      onRefresh={() => void fresh.refetch()}
    />
  );
}
