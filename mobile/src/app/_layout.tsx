import privateAssets from '@rack/private';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationTheme } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo, useState } from 'react';

import { PerfOverlay } from '@/components/PerfOverlay';
import { ToastProvider } from '@/components/Toast';
import { AppLock } from '@/features/lock/AppLock';
import { SessionProvider, useSession } from '@/lib/auth';
import { wireQueryToDevice } from '@/lib/online';
import { makeQueryClient } from '@/lib/queryClient';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

SplashScreen.preventAutoHideAsync();
wireQueryToDevice();

export default function RootLayout() {
  const [queryClient] = useState(makeQueryClient);
  // the owner's Neue Montreal files when present (@rack/private), else the system font
  const [fontsLoaded, fontError] = useFonts(privateAssets.fonts);
  if (!fontsLoaded && !fontError) return null;
  const customFont = fontsLoaded && !fontError && Object.keys(privateAssets.fonts).length > 0;
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider queryClient={queryClient}>
        <ThemeProvider customFont={customFont}>
          <ToastProvider>
            <AppLock>
              <RootStack />
              <PerfOverlay />
            </AppLock>
          </ToastProvider>
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}

function RootStack() {
  const session = useSession();
  const { scheme, colors } = useTheme();
  const navTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.foreground, // monochrome tint, like the web
        background: colors.background,
        card: colors.background,
        text: colors.foreground,
        border: colors.border,
      },
    };
  }, [scheme, colors]);

  useEffect(() => {
    if (session.status !== 'loading') void SplashScreen.hideAsync();
  }, [session.status]);
  if (session.status === 'loading') return null;

  const signedIn = session.status === 'signedIn';
  return (
    <NavigationTheme value={navTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="profile" options={{ presentation: 'modal' }} />
          <Stack.Screen name="listing/[id]" options={{ presentation: 'modal', headerShown: true }} />
          <Stack.Screen
            name="bought/[id]"
            options={{
              presentation: 'formSheet',
              headerShown: true,
              title: 'I bought it',
              sheetAllowedDetents: [0.45],
              sheetGrabberVisible: true,
            }}
          />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </NavigationTheme>
  );
}
