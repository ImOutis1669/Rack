import { describe, expect, it } from "vitest";

import { frameStats, perfEnabled } from "./perf";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("perfEnabled", () => {
  it("switches on with ?perf=1, stays on for the tab, and off with ?perf=0", () => {
    const s = memory();
    expect(perfEnabled("", s)).toBe(false);
    expect(perfEnabled("?perf=1", s)).toBe(true);
    expect(perfEnabled("?sort=newest", s)).toBe(true);
    expect(perfEnabled("?perf=0", s)).toBe(false);
    expect(perfEnabled("", null)).toBe(false);
  });
});

describe("frameStats", () => {
  it("summarises frame gaps", () => {
    const smooth = Array.from({ length: 100 }, () => 16.7);
    expect(frameStats(smooth)).toEqual({ frames: 100, median: 16.7, p95: 16.7, dropped: 0, fps: 60 });
    const janky = [...smooth.slice(0, 90), ...Array.from({ length: 10 }, () => 50)];
    const st = frameStats(janky)!;
    expect(st.dropped).toBe(10);
    expect(st.p95).toBe(50);
    expect(st.fps).toBeLessThan(60);
  });

  it("needs a couple of frames", () => {
    expect(frameStats([16])).toBeNull();
  });
});
