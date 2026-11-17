import type { TasteItem, TasteKind } from '@rack/shared/types';
import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { HeaderButtons } from '@/components/HeaderButtons';
import { Segmented } from '@/components/Segmented';
import { TasteTile } from '@/features/wardrobe/TasteTile';
import { WardrobeSummary } from '@/features/wardrobe/WardrobeSummary';
import { useSession } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';

const COPY: Record<TasteKind, string> = {
  wardrobe: 'Photos of clothes you own and love. Rack looks for things that look like them.',
  wishlist: 'Things you want: photos, links to listings, or a short description like “black derby shoes with a chunky sole”.',
};
const SIDE = 16;
const GAP = 12;

export default function WardrobeScreen() {
  const api = useSession().api();
  const { colors, text } = useTheme();
  const { width } = useWindowDimensions();
  const [kind, setKind] = useState<TasteKind>('wardrobe');
  const items = useQuery({
    queryKey: ['taste', kind],
    queryFn: () => api.taste(kind),
    // photos are read in the background: check again until every one is done
    refetchInterval: (q) => (q.state.data?.some((i) => !i.embedded && !i.embed_error) ? 5000 : false),
  });
  const tileWidth = (width - SIDE * 2 - GAP) / 2;
  const add = () => router.push({ pathname: '/wardrobe/add', params: { kind } });

  const renderItem = useCallback(
    ({ item }: { item: TasteItem }) => (
      <View style={{ paddingHorizontal: GAP / 2 }}>
        <TasteTile item={item} width={tileWidth} />
      </View>
    ),
    [tileWidth],
  );

  const header = (
    <View style={styles.header}>
      <Segmented
        label="Wardrobe or wishlist"
        value={kind}
        onChange={setKind}
        options={[
          ['wardrobe', 'Wardrobe'],
          ['wishlist', 'Wishlist'],
        ]}
      />
      <Text style={[text('footnote'), { color: colors.muted, paddingHorizontal: 6 }]}>{COPY[kind]}</Text>
      {kind === 'wardrobe' && items.data && items.data.length > 0 ? <WardrobeSummary items={items.data} /> : null}
    </View>
  );

  return (
    <>
      <HeaderButtons title="Wardrobe">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel={`Add to ${kind}`} onPress={add} />
      </HeaderButtons>
      <FlashList
        data={items.data ?? []}
        extraData={kind}
        masonry
        numColumns={2}
        keyExtractor={(i) => String(i.id)}
        renderItem={renderItem}
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ paddingHorizontal: SIDE - GAP / 2, paddingBottom: 24 }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          items.isPending ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.muted} />
          ) : items.isError ? (
            <EmptyState icon="wardrobe" title="Couldn't load" body={(items.error as Error).message} action={{ label: 'Try again', onPress: () => void items.refetch() }} />
          ) : (
            <EmptyState
              icon="wardrobe"
              title={kind === 'wardrobe' ? 'Your wardrobe is empty' : 'Your wishlist is empty'}
              body="The more you add, the better the feed gets."
              action={{ label: kind === 'wardrobe' ? 'Add photos' : 'Add something', onPress: add }}
            />
          )
        }
        refreshing={items.isRefetching}
        onRefresh={() => void items.refetch()}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 6, gap: 12, paddingBottom: 20 },
});
