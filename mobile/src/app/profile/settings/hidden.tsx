import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScrollView, Text } from 'react-native';

import { Row, Section } from '@/components/Grouped';
import { useToast } from '@/components/Toast';
import { useSession } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';

export default function HiddenPage() {
  const api = useSession().api();
  const qc = useQueryClient();
  const toast = useToast();
  const { colors, text } = useTheme();
  const q = useQuery({ queryKey: ['hidden'], queryFn: api.hidden });
  const unhide = useMutation({
    mutationFn: api.unhide,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hidden'] });
      void qc.invalidateQueries({ queryKey: ['feed'] });
      toast('Unhidden. It shows in the feed again.');
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Couldn't unhide"),
  });
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingTop: 16 }}>
      {q.data && q.data.length === 0 ? (
        <Text style={[text('footnote'), { color: colors.muted, marginHorizontal: 32 }]}>
          Nothing hidden. Use the ⋯ menu on a listing to hide its seller or brand.
        </Text>
      ) : (
        <Section footer="Sellers and brands you hid from the feed. Tap one to show it again.">
          {q.data?.map((h) => (
            <Row
              key={h.id}
              label={h.value}
              detail={h.kind === 'seller' ? 'Seller' : 'Brand'}
              value="Unhide"
              hint="Shows it in the feed again"
              onPress={unhide.isPending ? undefined : () => unhide.mutate(h.id)}
            />
          ))}
        </Section>
      )}
    </ScrollView>
  );
}
