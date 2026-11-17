import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ScrollView, Switch } from 'react-native';

import { Row, Section } from '@/components/Grouped';
import { useProfile } from '@/features/settings/useProfile';
import { overallColor } from '@/features/settings/sources';
import { useSession } from '@/lib/auth';
import { setPerfEnabled, usePerf } from '@/lib/perfStore';
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
  const perf = usePerf();
  const p = profile.data?.profile;
  const go = (path: string) => () => router.push(path as never);

  const sizesSet = p ? Object.values(p.sizes).filter((v) => v?.length).length : 0;
  const channelsOn = notify.data?.filter((c) => c.configured).length ?? 0;
  const live = health.data?.filter((h) => h.status === 'ok').length;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }}>
      <Section title="Taste" footer="What Rack looks for. Changes re-rank the feed within a minute.">
        <Row label="Your style" detail={p?.context ? p.context.slice(0, 60) + (p.context.length > 60 ? '…' : '') : undefined} chevron onPress={go('/profile/settings/style')} />
        <Row label="Designers" value={designers.data ? String(designers.data.length) : undefined} chevron onPress={go('/profile/settings/designers')} />
        <Row label="Fit" chevron onPress={go('/profile/settings/fit')} />
        <Row label="Sizes" value={p ? (sizesSet ? `${sizesSet} set` : 'Any') : undefined} chevron onPress={go('/profile/settings/sizes')} />
        <Row label="Budget" value={p?.budget.default_max_gbp != null ? `£${p.budget.default_max_gbp}` : p ? 'None' : undefined} chevron onPress={go('/profile/settings/budget')} />
        <Row label="Feed" detail="Categories, exploration, banned words" chevron onPress={go('/profile/settings/feed')} />
      </Section>
      <Section title="Rack">
        <Row label="Alerts" value={notify.data ? (channelsOn ? `${channelsOn} on` : 'Off') : undefined} chevron onPress={go('/profile/settings/alerts')} />
        <Row label="Hidden sellers and brands" value={hidden.data ? String(hidden.data.length) : undefined} chevron onPress={go('/profile/settings/hidden')} />
        <Row
          label="Sources"
          dot={overallColor(health.data, colors)}
          value={live != null ? `${live} of ${health.data?.length} working` : undefined}
          chevron
          onPress={go('/profile/settings/sources')}
        />
      </Section>
      <Section title="Developer" footer="Frame rate, time to the first feed and API timings, drawn over the app. Nothing is stored or sent.">
        <Row
          label="Performance readout"
          right={
            <Switch
              style={{ marginLeft: 'auto' }}
              value={perf.enabled}
              accessibilityLabel="Performance readout"
              onValueChange={setPerfEnabled}
            />
          }
        />
      </Section>
    </ScrollView>
  );
}
