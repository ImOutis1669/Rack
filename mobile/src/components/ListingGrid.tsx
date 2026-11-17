// The masonry grid of listing tiles shared by the feed, Saved and hunt matches.
import { laneGeometry } from '@rack/shared/grid';
import type { Listing } from '@rack/shared/types';
import { FlashList, type ViewToken } from '@shopify/flash-list';
import { useCallback, useRef, type ReactElement } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { ListingTile } from './ListingTile';

const SIDE = 16;

interface Props {
  items: Listing[];
  header?: ReactElement | null;
  empty?: ReactElement | null;
  footer?: ReactElement | null;
  onEndReached?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Called once a tile has been 60% on screen for 1.2 s (the feed's "seen"). */
  onSeen?: (id: number) => void;
  /** Saved: an "I bought it" button under each tile. */
  showBought?: boolean;
}

export function ListingGrid({ items, header, empty, footer, onEndReached, refreshing, onRefresh, onSeen, showBought }: Props) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const grid = laneGeometry(width - SIDE * 2);
  const tileWidth = (width - SIDE * 2 + grid.gap) / grid.lanes - grid.gap;

  const viewability = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 1200 }).current;
  const onSeenRef = useRef(onSeen);
  onSeenRef.current = onSeen;
  const onViewable = useRef(({ changed }: { changed: ViewToken<Listing>[] }) => {
    for (const t of changed) if (t.isViewable && t.item) onSeenRef.current?.(t.item.id);
  }).current;

  const renderItem = useCallback(
    ({ item }: { item: Listing }) => (
      <View style={{ paddingHorizontal: grid.gap / 2 }}>
        <ListingTile item={item} width={tileWidth} showBought={showBought} />
      </View>
    ),
    [tileWidth, grid.gap, showBought],
  );

  return (
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
      ListFooterComponent={footer}
      onEndReached={onEndReached}
      onEndReachedThreshold={1.5}
      refreshing={refreshing}
      onRefresh={onRefresh}
      viewabilityConfig={onSeen ? viewability : undefined}
      onViewableItemsChanged={onSeen ? onViewable : undefined}
    />
  );
}
