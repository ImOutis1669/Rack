import { freshTitle } from '@rack/shared/fresh';
import { timeAgo } from '@rack/shared/format';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { ListingTile } from '@/components/ListingTile';
import { useSession } from '@/lib/auth';
import { kv } from '@/lib/storage';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/type';

export const FRESH_DISMISSED_KEY = 'rack.freshDismissed';
const TILE = 150;

/** "New for you" at the top of the feed (the web's strip): the strong new finds of your latest
 *  Refresh, best first. Under the "feed" query key, so pull to refresh reloads it too. Closing
 *  it hides it until your next refresh. */
export function NewForYou() {
  const api = useSession().api();
  const { colors, text, customFont } = useTheme();
  const [dismissed, setDismissed] = useState(() => kv.getItem(FRESH_DISMISSED_KEY));
  const fresh = useQuery({ queryKey: ['feed', 'fresh'], queryFn: () => api.fresh(12), staleTime: 30_000 });

  const page = fresh.data;
  if (!page?.total || !page.since || dismissed === page.since) return null;
  const since = page.since;

  return (
    <View style={styles.section} accessibilityLabel="New for you">
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={[text('headline'), { color: colors.foreground }]}>{freshTitle(page.total)}</Text>
          <Text style={[text('footnote'), { color: colors.muted }]}>From your refresh {timeAgo(since)}, best matches first</Text>
        </View>
        {page.total > page.items.length ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push('/new')} style={styles.action}>
            <Text style={[text('footnote'), font('medium', customFont), { color: colors.foreground }]}>Show all</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hide new for you"
          hitSlop={8}
          onPress={() => {
            setDismissed(since);
            kv.setItem(FRESH_DISMISSED_KEY, since);
          }}
          style={[styles.close, { backgroundColor: colors.fill }]}>
          <Icon name="close" size={14} color={colors.muted} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} decelerationRate="fast" snapToInterval={TILE + 10}>
        {page.items.map((item) => (
          <ListingTile key={item.id} item={item} width={TILE} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingBottom: 20 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6, paddingBottom: 10 },
  action: { minHeight: 36, justifyContent: 'center' },
  close: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  row: { gap: 10, paddingHorizontal: 6 },
});
