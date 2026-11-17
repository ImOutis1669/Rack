import { Stack } from 'expo-router';

import { useTheme } from '@/theme/ThemeProvider';

import { HeaderButtons } from './HeaderButtons';

/** Native header options in Rack's fonts. Tab pages draw their own inline title (v2.1), so the
 *  native title and large title are off; pushed pages and sheets keep a centred native title. */
export function useHeaderOptions() {
  const { colors, customFont } = useTheme();
  return {
    headerLargeTitleEnabled: false,
    headerShadowVisible: false,
    headerTintColor: colors.foreground,
    headerTitleStyle: customFont ? { fontFamily: 'NeueMontreal-Medium' } : undefined,
    contentStyle: { backgroundColor: colors.background },
  } as const;
}

/** Options for a tab's first page: no native title (the inline one is in the toolbar), but the
 *  title still names the screen for VoiceOver and the back button of pages pushed from it. */
export const tabPageOptions = (title: string) => ({ title, headerTitle: '' }) as const;

/** The stack inside one tab whose page has no buttons of its own (Saved). */
export function TabStack({ title }: { title: string }) {
  const header = useHeaderOptions();
  return (
    <Stack screenOptions={header}>
      <Stack.Screen name="index" options={tabPageOptions(title)}>
        <HeaderButtons title={title} />
      </Stack.Screen>
    </Stack>
  );
}
