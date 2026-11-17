import { timeAgo } from '@rack/shared/format';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { ScrollView } from 'react-native';

import { Row, Section } from '@/components/Grouped';
import { useSession } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';

const NAMES: Record<string, string> = { ntfy: 'ntfy', telegram: 'Telegram', webpush: 'Web Push (browsers)' };

// Alert channels (the web's Notifications section, without "this device": the iOS app has no
// push until it's signed with a paid developer account, so alerts come through ntfy/Telegram).
export default function AlertsPage() {
  const api = useSession().api();
  const { colors } = useTheme();
  const status = useQuery({ queryKey: ['notify-status'], queryFn: api.notifyStatus });
  const recent = useQuery({ queryKey: ['notify-recent'], queryFn: api.notifyRecent });
  const test = useMutation({
    mutationFn: api.notifyTest,
    onSuccess: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  });
  const anyOn = status.data?.some((c) => c.configured);
  const result = test.data
    ? Object.entries(test.data)
        .map(([k, v]) => `${NAMES[k] ?? k}: ${v}`)
        .join(' · ')
    : test.isError
      ? (test.error as Error).message
      : undefined;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingTop: 16, paddingBottom: 40 }}>
      <Section
        title="Channels"
        footer="Hunt matches and price drops on saved items go to every channel that's set up. ntfy and Telegram are set in .env on the server. This app can't receive push notifications yet: that needs the paid Apple developer account.">
        {status.data?.map((c) => (
          <Row
            key={c.name}
            label={NAMES[c.name] ?? c.name}
            detail={c.detail}
            value={c.configured ? 'On' : 'Off'}
            dot={c.configured ? colors.accent : colors.subtle}
          />
        ))}
      </Section>
      <Section footer={result}>
        <Row
          label={test.isPending ? 'Sending' : 'Send test alert'}
          onPress={anyOn && !test.isPending ? () => test.mutate() : undefined}
          detail={anyOn ? undefined : 'Set up ntfy or Telegram first.'}
        />
      </Section>
      {recent.data?.length ? (
        <Section title="Recent alerts">
          {recent.data.slice(0, 8).map((n, i) => (
            <Row key={i} label={n.title} detail={`${n.body} · ${timeAgo(n.sent_at)}`} />
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );
}
