import { router, Stack } from 'expo-router';

import { useHeaderOptions } from '@/components/TabStack';

// Settings opens as a modal sheet from the gear in every tab's header; each section is a page.
export default function SettingsLayout() {
  const header = useHeaderOptions();
  const page = { headerLargeTitleEnabled: false } as const;
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={{ title: 'Settings' }}>
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="checkmark" variant="done" accessibilityLabel="Done" onPress={() => router.back()} />
        </Stack.Toolbar>
      </Stack.Screen>
      <Stack.Screen name="style" options={{ ...page, title: 'Your style' }} />
      <Stack.Screen name="designers" options={{ ...page, title: 'Designers' }} />
      <Stack.Screen name="fit" options={{ ...page, title: 'Fit' }} />
      <Stack.Screen name="sizes" options={{ ...page, title: 'Sizes' }} />
      <Stack.Screen name="budget" options={{ ...page, title: 'Budget' }} />
      <Stack.Screen name="feed" options={{ ...page, title: 'Feed' }} />
      <Stack.Screen name="alerts" options={{ ...page, title: 'Alerts' }} />
      <Stack.Screen name="hidden" options={{ ...page, title: 'Hidden' }} />
      <Stack.Screen name="sources" options={{ ...page, title: 'Sources' }} />
    </Stack>
  );
}
