import type { Vote } from '@rack/shared/vote';
import { Pressable, StyleSheet } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

import { Icon } from './Icon';

/**
 * Up and down as two round buttons, like the sheet's other actions (user's choice over the web's
 * single capsule). Outline when off; filled green (up) or red (down) when cast; tap again to clear.
 */
export function VoteButtons({ vote, onVote }: { vote: Vote; onVote: (v: -1 | 1) => void }) {
  const { colors } = useTheme();
  return (
    <>
      {([1, -1] as const).map((v) => {
        const on = vote === v;
        return (
          <Pressable
            key={v}
            accessibilityRole="button"
            accessibilityLabel={v === 1 ? 'More like this' : 'Less like this'}
            accessibilityState={{ selected: on }}
            onPress={() => onVote(v)}
            style={({ pressed }) => [styles.round, { backgroundColor: colors.fill, transform: [{ scale: pressed ? 0.9 : 1 }] }]}>
            <Icon
              name={v === 1 ? 'vote-up' : 'vote-down'}
              filled={on}
              size={22}
              color={on ? (v === 1 ? colors.accent : colors.danger) : colors.foreground}
            />
          </Pressable>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
