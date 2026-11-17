/**
 * Performance readout (?perf=1): numbers measured on the real device, for the v1.1 performance
 * work. Off unless switched on; ?perf=0 switches it off again. Nothing is stored or sent.
 */

const KEY = "rack.perf";

/** On when the URL says ?perf=1 (remembered for this tab), off with ?perf=0. */
export function perfEnabled(search: string, store: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null): boolean {
  const flag = new URLSearchParams(search).get("perf");
  try {
    if (flag === "1") store?.setItem(KEY, "1");
    if (flag === "0") store?.removeItem(KEY);
    return store?.getItem(KEY) === "1" || flag === "1";
  } catch {
    return flag === "1";
  }
}

export interface FrameStats {
  frames: number;
  median: number; // ms between frames
  p95: number;
  dropped: number; // gaps longer than 1.5 expected frames
  fps: number;
}

/** Stats for the gaps between animation frames recorded while scrolling. */
export function frameStats(gaps: number[], expected = 1000 / 60): FrameStats | null {
  const g = gaps.filter((x) => x > 0 && Number.isFinite(x));
  if (g.length < 2) return null;
  const s = [...g].sort((a, b) => a - b);
  const pick = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
  const total = g.reduce((a, b) => a + b, 0);
  return {
    frames: g.length,
    median: round1(pick(0.5)),
    p95: round1(pick(0.95)),
    dropped: g.filter((x) => x > expected * 1.5).length,
    fps: Math.round((g.length / total) * 1000),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
