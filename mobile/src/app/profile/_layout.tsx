import { router, Stack } from 'expo-router';

import { useHeaderOptions } from '@/components/TabStack';

// Profile (v2.1) opens as a modal sheet from the avatar in every tab's header. Settings and its
// sections push inside the same sheet (one flat stack: no sheet on top of a sheet).
export default function ProfileLayout() {
  const header = useHeaderOptions();
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={{ title: 'Profile' }}>
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="checkmark" variant="done" accessibilityLabel="Done" onPress={() => router.back()} />
        </Stack.Toolbar>
      </Stack.Screen>
      <Stack.Screen name="password" options={{ title: 'Change password' }} />
      <Stack.Screen name="privacy" options={{ title: 'Privacy' }} />
      <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
      <Stack.Screen name="settings/style" options={{ title: 'Your style' }} />
      <Stack.Screen name="settings/designers" options={{ title: 'Designers' }} />
      <Stack.Screen name="settings/fit" options={{ title: 'Fit' }} />
      <Stack.Screen name="settings/sizes" options={{ title: 'Sizes' }} />
      <Stack.Screen name="settings/budget" options={{ title: 'Budget' }} />
      <Stack.Screen name="settings/feed" options={{ title: 'Feed' }} />
      <Stack.Screen name="settings/alerts" options={{ title: 'Alerts' }} />
      <Stack.Screen name="settings/hidden" options={{ title: 'Hidden' }} />
      <Stack.Screen name="settings/sources" options={{ title: 'Sources' }} />
    </Stack>
  );
}
