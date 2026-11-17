// Monthly median sold prices (the web's Sparkline): muted line, latest month in the accent,
// gaps for months with too few sales. Tap a month for its numbers; the list is the table view.
import { formatGBP } from '@rack/shared/format';
import { sparkGeometry } from '@rack/shared/trend';
import type { TrendPoint } from '@rack/shared/types';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Polyline, Rect } from 'react-native-svg';

import { useTheme } from '@/theme/ThemeProvider';
import { tabular } from '@/theme/type';

const H = 56;

function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function readout(p: TrendPoint): string {
  return `${formatGBP(p.median)} median · 30 days to ${monthLabel(p.end)} · ${p.sales} sale${p.sales === 1 ? '' : 's'}`;
}

export function Sparkline({ points, width }: { points: TrendPoint[]; width: number }) {
  const { colors, text } = useTheme();
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const g = sparkGeometry(points, width, H, 6);
  if (!g.dots.length) return null;
  const shown = active != null ? g.dots[active] : g.dots[g.dots.length - 1];
  return (
    <View style={{ gap: 6 }}>
      <Text accessibilityLiveRegion="polite" style={[text('caption'), tabular, { color: colors.muted, minHeight: 16 }]}>
        {shown ? readout(shown.point) : ''}
      </Text>
      <Svg width={width} height={H} accessibilityLabel="Median sold price by month over the last 6 months">
        {g.segments.map((pts) => (
          <Polyline key={pts} points={pts} fill="none" stroke={colors.subtle} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {g.dots.map((d, i) => (
          <Circle
            key={d.point.end}
            cx={d.x}
            cy={d.y}
            r={d.last || active === i ? 4 : 2.5}
            fill={d.last ? colors.accent : colors.subtle}
            stroke={colors.background}
            strokeWidth={active === i ? 2 : 0}
          />
        ))}
        {g.dots.map((d, i) => (
          <Rect key={`hit-${d.point.end}`} x={d.x - 14} y={0} width={28} height={H} fill="transparent" onPress={() => setActive(active === i ? null : i)} />
        ))}
      </Svg>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: table }} onPress={() => setTable((t) => !t)} hitSlop={8}>
        <Text style={[text('caption'), { color: colors.muted }]}>{table ? 'Hide monthly medians' : 'Monthly medians'}</Text>
      </Pressable>
      {table
        ? points.map((p) => (
            <Text key={p.end} style={[text('caption'), tabular, { color: colors.muted }]}>
              30 days to {monthLabel(p.end)}: {p.median ? formatGBP(p.median) : 'too few sales'} ({p.sales})
            </Text>
          ))
        : null}
    </View>
  );
}
