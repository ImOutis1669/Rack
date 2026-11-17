import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, ScrollView } from 'react-native';

import { Row, Section } from '@/components/Grouped';
import { useProfile } from '@/features/settings/useProfile';
import { overallColor } from '@/features/settings/sources';
import { useSession } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';

export default function SettingsScreen() {
  const session = useSession();
  const api = session.api();
  const { colors } = useTheme();
  const profile = useProfile();
  const designers = useQuery({ queryKey: ['designers'], queryFn: api.designers });
  const hidden = useQuery({ queryKey: ['hidden'], queryFn: api.hidden });
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 60_000 });
  const notify = useQuery({ queryKey: ['notify-status'], queryFn: api.notifyStatus });
  const p = profile.data?.profile;
  const go = (path: string) => () => router.push(path as never);

  const logOutEverywhere = () =>
    Alert.alert('Log out everywhere?', 'Every phone and browser signed in to Rack will need the password again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out everywhere',
        style: 'destructive',
        onPress: () =>
          session.logOutEverywhere().catch((e: unknown) =>
            Alert.alert("Couldn't log out everywhere", e instanceof Error ? e.message : undefined),
          ),
      },
    ]);

  const sizesSet = p ? Object.values(p.sizes).filter((v) => v?.length).length : 0;
  const channelsOn = notify.data?.filter((c) => c.configured).length ?? 0;
  const live = health.data?.filter((h) => h.status === 'ok').length;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }}>
      <Section title="Taste" footer="What Rack looks for. Changes re-rank the feed within a minute.">
        <Row label="Your style" detail={p?.context ? p.context.slice(0, 60) + (p.context.length > 60 ? '…' : '') : undefined} chevron onPress={go('/settings/style')} />
        <Row label="Designers" value={designers.data ? String(designers.data.length) : undefined} chevron onPress={go('/settings/designers')} />
        <Row label="Fit" chevron onPress={go('/settings/fit')} />
        <Row label="Sizes" value={p ? (sizesSet ? `${sizesSet} set` : 'Any') : undefined} chevron onPress={go('/settings/sizes')} />
        <Row label="Budget" value={p?.budget.default_max_gbp != null ? `£${p.budget.default_max_gbp}` : p ? 'None' : undefined} chevron onPress={go('/settings/budget')} />
        <Row label="Feed" detail="Categories, exploration, banned words" chevron onPress={go('/settings/feed')} />
      </Section>
      <Section title="Rack">
        <Row label="Alerts" value={notify.data ? (channelsOn ? `${channelsOn} on` : 'Off') : undefined} chevron onPress={go('/settings/alerts')} />
        <Row label="Hidden sellers and brands" value={hidden.data ? String(hidden.data.length) : undefined} chevron onPress={go('/settings/hidden')} />
        <Row
          label="Sources"
          dot={overallColor(health.data, colors)}
          value={live != null ? `${live} of ${health.data?.length} working` : undefined}
          chevron
          onPress={go('/settings/sources')}
        />
      </Section>
      <Section
        title="Account"
        footer="Log out forgets the password on this iPhone only. Log out everywhere ends every session and app login, including this one: use it if a device is lost. Changing your password does the same.">
        <Row label="Server" value={session.server?.replace('https://', '') ?? ''} />
        <Row label="Log out" onPress={() => void session.signOut()} />
        <Row label="Log out everywhere" destructive onPress={logOutEverywhere} />
      </Section>
    </ScrollView>
  );
}
