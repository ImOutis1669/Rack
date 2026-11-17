import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';
import { font, tabular } from '@/theme/type';

/** Match score as a ring (the web's AnimatedCircularProgressBar), accent green. */
export function ScoreRing({ value, size = 56 }: { value: number; size?: number }) {
  const { colors, text, customFont } = useTheme();
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Match ${value} percent`}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.fillStrong} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${(c * value) / 100} ${c}`}
        />
      </Svg>
      <Text style={[text('footnote'), font('medium', customFont), tabular, { color: colors.foreground }]}>{value}%</Text>
    </View>
  );
}
