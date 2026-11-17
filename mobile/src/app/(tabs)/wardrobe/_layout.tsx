import { Stack } from 'expo-router';

import { tabPageOptions, useHeaderOptions } from '@/components/TabStack';

// Wardrobe tab: the grid, the add sheet, and an item's sheet (view + edit).
export default function WardrobeLayout() {
  const header = useHeaderOptions();
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={tabPageOptions('Wardrobe')} />
      <Stack.Screen
        name="add"
        options={{ presentation: 'formSheet', sheetAllowedDetents: [0.75, 1], sheetGrabberVisible: true, headerLargeTitleEnabled: false }}
      />
      <Stack.Screen name="[id]" options={{ presentation: 'modal', headerLargeTitleEnabled: false, title: '' }} />
    </Stack>
  );
}
