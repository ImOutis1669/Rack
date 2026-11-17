import { router, Stack } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';

import { useAccount } from '@/lib/useAccount';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/type';

import { Avatar } from './Avatar';

/**
 * A tab page's header (v2.1): its title inline on the left, like Grailed's logo (no iOS large
 * title), and on the right the page's buttons in one glass group, ending with your avatar,
 * which opens Profile (it replaced the gear).
 */
export function HeaderButtons({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.View hidesSharedBackground>
          <InlineTitle title={title} />
        </Stack.Toolbar.View>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        {children}
        <Stack.Toolbar.View>
          <ProfileButton />
        </Stack.Toolbar.View>
      </Stack.Toolbar>
    </>
  );
}

function InlineTitle({ title }: { title: string }) {
  const { colors, customFont } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={1}
      style={[font('bold', customFont), { color: colors.foreground, fontSize: 28, letterSpacing: -0.6, paddingLeft: 6 }]}>
      {title}
    </Text>
  );
}

function ProfileButton() {
  const account = useAccount();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Profile"
      hitSlop={6}
      onPress={() => router.push('/profile')}
      style={({ pressed }) => ({ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <Avatar account={account.data} size={30} />
    </Pressable>
  );
}
