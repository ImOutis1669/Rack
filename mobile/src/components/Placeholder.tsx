import { ScrollView, Text } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';

/** Stand-in page body until its step is built (iOS steps 4-7). */
export function Placeholder({ text }: { text: string }) {
  const { colors, text: type } = useTheme();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16 }}>
      <Text style={[type('body'), { color: colors.muted }]}>{text}</Text>
    </ScrollView>
  );
}
