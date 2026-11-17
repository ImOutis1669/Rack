// Your photo, or your initials on a quiet fill until you set one (v2.1 Profile).
import { initials } from '@rack/shared/account';
import type { Account } from '@rack/shared/types';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { useSession } from '@/lib/auth';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/type';

export function Avatar({ account, size = 30 }: { account?: Account | null; size?: number }) {
  const session = useSession();
  const { colors, customFont } = useTheme();
  const name = account?.display_name || account?.username || '';
  const uri = account?.avatar && session.server ? `${session.server}${account.avatar}` : null;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.fillStrong }]}>
      {uri ? (
        // the URL carries ?v=N, so a new photo is a new cache entry
        <Image source={{ uri, headers: session.imageHeaders(), cacheKey: uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} />
      ) : (
        <Text style={[font('medium', customFont), { color: colors.muted, fontSize: Math.round(size * 0.4) }]}>{initials(name)}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
