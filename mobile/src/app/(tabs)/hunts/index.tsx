import { timeAgo } from '@rack/shared/format';
import { huntSummary } from '@rack/shared/hunts';
import type { Hunt, HuntInput } from '@rack/shared/types';
import { useQueryClient } from '@tanstack/react-query';
import { Link, router, Stack, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/EmptyState';
import { HeaderButtons } from '@/components/HeaderButtons';
import { Icon } from '@/components/Icon';
import { huntStatus, useHuntActions } from '@/features/hunts/useHuntActions';
import { useHunts } from '@/features/hunts/useHunts';
import { useTheme } from '@/theme/ThemeProvider';
import { font, tabular } from '@/theme/type';


export default function HuntsScreen() {
  const hunts = useHunts();
  const qc = useQueryClient();
  const { colors, text } = useTheme();

  // "Hunt for this" on a listing leaves a prefill: open the form with it once
  useFocusEffect(
    useCallback(() => {
      if (qc.getQueryData<HuntInput>(['huntPrefill'])) router.push({ pathname: '/hunts/form', params: { prefill: '1' } });
    }, [qc]),
  );

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.body}
      refreshControl={<RefreshControl refreshing={hunts.isRefetching} onRefresh={() => void hunts.refetch()} />}>
      <HeaderButtons title="Hunts">
        <Stack.Toolbar.Button icon="plus" accessibilityLabel="New hunt" onPress={() => router.push('/hunts/form')} />
      </HeaderButtons>
      <Text style={[text('footnote'), { color: colors.muted }]}>
        Saved searches that run on their own schedule. You get an alert when something new matches.
      </Text>
      {hunts.isPending ? <ActivityIndicator style={{ marginTop: 40 }} color={colors.muted} /> : null}
      {hunts.isError ? (
        <EmptyState
          icon="hunts"
          title="Couldn't load hunts"
          body={(hunts.error as Error).message}
          action={{ label: 'Try again', onPress: () => void hunts.refetch() }}
        />
      ) : null}
      {hunts.isSuccess && hunts.data.length === 0 ? (
        <EmptyState
          icon="hunts"
          title="No hunts yet"
          body="Hunt for a specific piece, like Rick Owens Geobaskets under £400, or use Hunt for this on any listing."
          action={{ label: 'New hunt', onPress: () => router.push('/hunts/form') }}
        />
      ) : null}
      {hunts.data?.map((h) => <HuntCard key={h.id} hunt={h} />)}
    </ScrollView>
  );
}

/** One hunt: name, what it looks for, status, matches. Tap for its matches; long-press for actions. */
function HuntCard({ hunt }: { hunt: Hunt }) {
  const { colors, text, customFont } = useTheme();
  const a = useHuntActions(hunt);
  const status = huntStatus(hunt, (iso) => timeAgo(iso));
  return (
    <Link href={{ pathname: '/hunts/[id]', params: { id: String(hunt.id) } }} asChild>
      <Link.Trigger>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${hunt.name}, ${hunt.match_count} matches${hunt.new_count ? `, ${hunt.new_count} new` : ''}, ${status}${hunt.enabled ? '' : ', paused'}`}
          accessibilityHint="Opens its matches. Long-press for actions."
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: colors.surface, opacity: hunt.enabled ? 1 : 0.7, transform: [{ scale: pressed ? 0.98 : 1 }] },
          ]}>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.titleRow}>
              <Text numberOfLines={1} style={[text('headline'), { fontSize: 17, color: colors.foreground, flexShrink: 1 }]}>
                {hunt.name}
              </Text>
              {!hunt.enabled ? (
                <View style={[styles.pill, { backgroundColor: colors.fill }]}>
                  <Text style={[text('caption'), font('medium', customFont), { color: colors.muted }]}>Paused</Text>
                </View>
              ) : null}
              {!hunt.notify ? <Icon name="mute" size={14} color={colors.muted} label="Alerts off" /> : null}
            </View>
            <Text style={[text('footnote'), { color: colors.muted }]}>{huntSummary(hunt)}</Text>
            <Text style={[text('caption'), { color: colors.muted, marginTop: 4 }]}>{status}</Text>
            {hunt.last_error ? <Text style={[text('caption'), { color: colors.warning }]}>{hunt.last_error}</Text> : null}
          </View>
          <View style={styles.count}>
            <Text style={[text('title'), font('bold', customFont), tabular, { color: colors.foreground }]}>{hunt.match_count}</Text>
            <Text style={[text('caption'), { color: hunt.new_count ? colors.accent : colors.muted }]}>
              {hunt.new_count ? `${hunt.new_count} new` : 'matches'}
            </Text>
          </View>
          <Icon name="chevron-right" size={14} color={colors.subtle} />
        </Pressable>
      </Link.Trigger>
      <Link.Menu>
        <Link.MenuAction icon="arrow.clockwise" disabled={a.running} onPress={a.run}>
          Run now
        </Link.MenuAction>
        <Link.MenuAction icon={hunt.enabled ? 'pause' : 'play'} onPress={() => a.setEnabled(!hunt.enabled)}>
          {hunt.enabled ? 'Pause' : 'Resume'}
        </Link.MenuAction>
        <Link.MenuAction icon={hunt.notify ? 'bell.slash' : 'bell'} onPress={() => a.setNotify(!hunt.notify)}>
          {hunt.notify ? 'Mute alerts' : 'Turn alerts on'}
        </Link.MenuAction>
        <Link.MenuAction icon="pencil" onPress={a.edit}>
          Edit
        </Link.MenuAction>
        <Link.MenuAction icon="trash" destructive onPress={a.remove}>
          Delete
        </Link.MenuAction>
      </Link.Menu>
    </Link>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12, paddingBottom: 32 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 16, borderCurve: 'continuous' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  count: { alignItems: 'flex-end' },
});
