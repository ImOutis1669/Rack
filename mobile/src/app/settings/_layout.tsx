import { router, Stack } from 'expo-router';

import { useHeaderOptions } from '@/components/TabStack';

// Settings opens as a modal sheet from the gear in every tab's header.
export default function SettingsLayout() {
  const header = useHeaderOptions();
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={{ title: 'Settings' }}>
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="checkmark" variant="done" accessibilityLabel="Done" onPress={() => router.back()} />
        </Stack.Toolbar>
      </Stack.Screen>
    </Stack>
  );
}
