import { Stack } from 'expo-router';

import { tabPageOptions, useHeaderOptions } from '@/components/TabStack';

// Hunts tab: the list, one hunt's matches, and the new/edit form as a sheet.
export default function HuntsLayout() {
  const header = useHeaderOptions();
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={tabPageOptions('Hunts')} />
      <Stack.Screen name="[id]" options={{ title: '', headerLargeTitleEnabled: false }} />
      <Stack.Screen
        name="form"
        options={{
          presentation: 'formSheet',
          sheetAllowedDetents: [1],
          sheetGrabberVisible: true,
          headerLargeTitleEnabled: false,
        }}
      />
    </Stack>
  );
}
