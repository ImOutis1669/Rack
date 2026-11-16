import { describe, expect, it } from "vitest";

import type { Trend, TrendWindow } from "../api/types";
import { signedPct, sparkGeometry, tileBadge, windowText } from "./trend";

const w = (pct: number, direction: TrendWindow["direction"]): TrendWindow => ({
  pct,
  direction,
  recent_median: "520.00",
  prior_median: "460.00",
  recent_sales: 8,
  prior_sales: 6,
});
const trend = (t30: TrendWindow | null, t90: TrendWindow | null, sales = 20): Trend => ({ "30": t30, "90": t90, points: [], sales });

describe("trend labels", () => {
  it("signs percentages", () => {
    expect([signedPct(12.4), signedPct(-8.6), signedPct(0.2)]).toEqual(["+12%", "−9%", "0%"]);
  });

  it("prefers the 30-day window on tiles, then 90, and says the direction in words too", () => {
    expect(tileBadge(trend(w(12.4, "up"), w(-3, "steady")))).toEqual({
      text: "↑ 12%",
      direction: "up",
      title: "Rising +12% over 30 days (sold prices)",
    });
    expect(tileBadge(trend(null, w(-20, "down")))?.text).toBe("↓ 20%");
    expect(tileBadge(trend(null, null))).toBeNull();
    expect(tileBadge(null)).toBeNull();
  });

  it("explains each window or why there isn't one", () => {
    expect(windowText(trend(w(13, "up"), null), "30")).toBe(
      "Rising +13%: median sold price this month vs the 30 days before (8 and 6 sales).",
    );
    expect(windowText(trend(null, null), "90")).toMatch(/^Not enough sales yet for a 90-day trend/);
    expect(windowText(trend(null, null, 0), "30")).toBe("No comparable sales yet.");
  });
});

describe("sparkGeometry", () => {
  const p = (median: string | null) => ({ end: "2026-11-16", median, sales: median ? 3 : 0 });

  it("scales highs to the top and lows to the bottom", () => {
    const g = sparkGeometry([p("100"), p("200"), p("150")], 104, 24);
    expect(g.dots.map((d) => [d.x, d.y])).toEqual([
      [4, 20],
      [52, 4],
      [100, 12],
    ]);
    expect(g.segments).toEqual(["4,20 52,4 100,12"]);
    expect(g.dots.map((d) => d.last)).toEqual([false, false, true]);
  });

  it("breaks the line at months without enough sales", () => {
    const g = sparkGeometry([p("100"), p("120"), p(null), p("130"), p("140")], 104, 24);
    expect(g.segments).toHaveLength(2);
    expect(g.dots).toHaveLength(4);
  });

  it("draws a flat line in the middle and nothing without data", () => {
    expect(sparkGeometry([p("100"), p("100")], 100, 20).dots.every((d) => d.y === 10)).toBe(true);
    expect(sparkGeometry([p(null)], 100, 20)).toEqual({ segments: [], dots: [] });
  });
});
