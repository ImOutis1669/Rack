import { timeAgo } from '@rack/shared/format';
import { huntSummary } from '@rack/shared/hunts';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { ListingGrid } from '@/components/ListingGrid';
import { huntStatus, useHuntActions } from '@/features/hunts/useHuntActions';
import { useHunts } from '@/features/hunts/useHunts';
import { useSession } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';
import type { Hunt } from '@rack/shared/types';

// One hunt: what it looks for, its status, and its matches in the feed's grid.
export default function HuntScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const hunts = useHunts();
  const hunt = hunts.data?.find((h) => h.id === Number(id));
  const { colors, text } = useTheme();
  if (!hunt) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: 80, alignItems: 'center' }}>
        {hunts.isPending ? <ActivityIndicator color={colors.muted} /> : <Text style={[text('body'), { color: colors.muted }]}>This hunt is gone.</Text>}
      </View>
    );
  }
  return <HuntMatches hunt={hunt} />;
}

function HuntMatches({ hunt }: { hunt: Hunt }) {
  const api = useSession().api();
  const { colors, text } = useTheme();
  const a = useHuntActions(hunt);
  const matches = useQuery({
    queryKey: ['hunt-matches', hunt.id, hunt.match_count],
    queryFn: () => api.huntMatches(hunt.id),
  });

  const header = (
    <View style={styles.header}>
      <Text style={[text('footnote'), { color: colors.muted }]}>{huntSummary(hunt)}</Text>
      <Text style={[text('caption'), { color: colors.muted }]}>
        {huntStatus(hunt, (iso) => timeAgo(iso))}
        {hunt.enabled ? '' : ' · Paused'}
        {hunt.notify ? '' : ' · Alerts off'}
      </Text>
      {hunt.last_error ? <Text style={[text('caption'), { color: colors.warning }]}>{hunt.last_error}</Text> : null}
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: hunt.name }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="arrow.clockwise" accessibilityLabel="Run now" disabled={a.running} onPress={a.run} />
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Hunt actions" title="">
          <Stack.Toolbar.MenuAction icon={hunt.enabled ? 'pause' : 'play'} onPress={() => a.setEnabled(!hunt.enabled)}>
            {hunt.enabled ? 'Pause' : 'Resume'}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon={hunt.notify ? 'bell.slash' : 'bell'} onPress={() => a.setNotify(!hunt.notify)}>
            {hunt.notify ? 'Mute alerts' : 'Turn alerts on'}
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="pencil" onPress={a.edit}>
            Edit
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={a.remove}>
            Delete
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <ListingGrid
        items={matches.data ?? []}
        header={header}
        empty={
          matches.isPending ? (
            <ActivityIndicator style={{ marginTop: 40 }} color={colors.muted} />
          ) : (
            <EmptyState icon="hunts" title="No matches yet" body="New matches appear here and come as alerts." />
          )
        }
        refreshing={matches.isRefetching}
        onRefresh={() => void matches.refetch()}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 6, paddingBottom: 16, gap: 4 },
});
