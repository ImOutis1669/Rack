// On-device readout (Settings > Developer > Performance readout): JS frame rate, slow frames,
// time to the first feed page, and recent API timings. The web's PerfHud, for the app.
import { frameStats, type FrameStats } from '@rack/shared/perf';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePerf } from '@/lib/perfStore';
import { tabular } from '@/theme/type';

function useFrames(on: boolean): FrameStats | null {
  const [stats, setStats] = useState<FrameStats | null>(null);
  useEffect(() => {
    if (!on) return;
    let gaps: number[] = [];
    let last = 0;
    let raf = 0;
    const tick = (t: number) => {
      if (last) gaps.push(t - last);
      last = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // 120 Hz ProMotion: a frame is ~8.3 ms
    const every = setInterval(() => {
      setStats(frameStats(gaps, 1000 / 120));
      gaps = [];
    }, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(every);
    };
  }, [on]);
  return on ? stats : null;
}

export function PerfOverlay() {
  const perf = usePerf();
  const frames = useFrames(perf.enabled);
  const insets = useSafeAreaInsets();
  if (!perf.enabled) return null;
  const last = perf.requests.slice(0, 3);
  return (
    <View pointerEvents="none" style={[styles.box, { top: insets.top + 4 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={[styles.line, tabular]}>
        {frames ? `JS ${frames.fps} fps · p95 ${frames.p95} ms · ${frames.dropped} slow` : 'JS …'}
      </Text>
      <Text style={[styles.line, tabular]}>First feed {perf.firstFeedMs != null ? `${perf.firstFeedMs} ms` : '…'}</Text>
      {last.map((r, i) => (
        <Text key={i} numberOfLines={1} style={[styles.line, tabular]}>
          {r.ms} ms {r.status} {r.path}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', left: 8, maxWidth: 260, padding: 6, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.72)', gap: 1 },
  line: { color: '#fff', fontSize: 10 },
});
