import privateAssets from '@rack/private';
import { router, Stack } from 'expo-router';

import { useTheme } from '@/theme/ThemeProvider';

/** Native large-title header options in Rack's fonts. */
export function useHeaderOptions() {
  const { colors, customFont } = useTheme();
  return {
    headerLargeTitleEnabled: true,
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    headerTintColor: colors.foreground,
    headerLargeTitleStyle: customFont ? { fontFamily: 'NeueMontreal-Bold' } : undefined,
    headerTitleStyle: customFont ? { fontFamily: 'NeueMontreal-Medium' } : undefined,
    contentStyle: { backgroundColor: colors.background },
  } as const;
}

/** The stack inside one tab: its page has a native large title and the Settings button. */
export function TabStack({ title }: { title: string }) {
  const header = useHeaderOptions();
  const gear = privateAssets.barIcons.settings?.default ?? 'gearshape';
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={{ title }}>
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon={gear}
            iconRenderingMode="template"
            accessibilityLabel="Settings"
            onPress={() => router.push('/settings')}
          />
        </Stack.Toolbar>
      </Stack.Screen>
    </Stack>
  );
}
