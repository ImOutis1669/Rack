import { SOURCE_LABEL, timeAgo } from '@rack/shared/format';
import { useQuery } from '@tanstack/react-query';
import { RefreshControl, ScrollView } from 'react-native';

import { Row, Section } from '@/components/Grouped';
import { STATUS_LABEL, statusColor } from '@/features/settings/sources';
import { useSession } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';

// The web's Sources sheet: each marketplace's health and eBay's daily API usage.
export default function SourcesPage() {
  const api = useSession().api();
  const { colors } = useTheme();
  const q = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 60_000 });
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ paddingTop: 16 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}>
      <Section footer="eBay uses its official API (5,000 searches a day). Vinted and Grailed are read the same way their websites read them, so a change on their side can stop one. Rack keeps going with the others.">
        {q.data?.map((h) => (
          <Row
            key={h.source}
            label={SOURCE_LABEL[h.source] ?? h.source}
            dot={statusColor(h, colors)}
            value={h.usage_warning && h.status === 'ok' ? 'Near daily limit' : STATUS_LABEL[h.status]}
            detail={[
              h.last_success_at &&
                `Last checked ${timeAgo(h.last_success_at)}${h.last_result_count != null ? ` · ${h.last_result_count} results` : ''}`,
              h.usage,
              h.status !== 'ok' && h.last_error,
            ]
              .filter(Boolean)
              .join('. ')}
          />
        ))}
      </Section>
    </ScrollView>
  );
}
