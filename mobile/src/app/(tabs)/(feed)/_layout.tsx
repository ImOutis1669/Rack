import { Stack } from 'expo-router';

import { useHeaderOptions } from '@/components/TabStack';
import { FeedParamsProvider } from '@/features/feed/FeedParams';

// The feed tab: the feed (its header buttons live in the page, they depend on its filters) and
// the Filters sheet, sharing the filter state.
export default function FeedLayout() {
  const header = useHeaderOptions();
  return (
    <FeedParamsProvider>
      <Stack screenOptions={header}>
        <Stack.Screen name="index" options={{ title: 'Rack' }} />
        <Stack.Screen
          name="filters"
          options={{
            title: 'Filters',
            presentation: 'formSheet',
            sheetAllowedDetents: [0.62, 1],
            sheetGrabberVisible: true,
            headerLargeTitleEnabled: false,
          }}
        />
      </Stack>
    </FeedParamsProvider>
  );
}
