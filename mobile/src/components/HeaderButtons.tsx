import { router, Stack } from 'expo-router';
import type { ReactNode } from 'react';

/** A page's right-hand header buttons (native bar items in one glass group), ending with Settings. */
export function HeaderButtons({ children }: { children?: ReactNode }) {
  return (
    <Stack.Toolbar placement="right">
      {children}
      <Stack.Toolbar.Button icon="gearshape" accessibilityLabel="Settings" onPress={() => router.push('/settings')} />
    </Stack.Toolbar>
  );
}
