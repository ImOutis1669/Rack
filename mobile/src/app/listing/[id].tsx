import type { Listing } from '@rack/shared/types';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, Text } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

// Stand-in for the listing sheet (iOS step 5). The tile puts the listing in the cache before opening.
export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useQuery<Listing>({ queryKey: ['listing', Number(id)], enabled: false });
  const { colors, text } = useTheme();
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }} style={{ backgroundColor: colors.background }}>
      <Text style={[text('title'), { color: colors.foreground }]}>{data?.title ?? 'Listing'}</Text>
      <Text style={[text('footnote'), { color: colors.muted }]}>The listing sheet comes in iOS step 5.</Text>
    </ScrollView>
  );
}
