import type { Trend, TrendPoint, TrendWindow } from "../api/types";

export type WindowDays = "30" | "90";

const WORD: Record<TrendWindow["direction"], string> = { up: "Rising", down: "Falling", steady: "Steady" };
const ARROW: Record<TrendWindow["direction"], string> = { up: "↑", down: "↓", steady: "→" };

/** "+12%", "−8%", "0%" */
export function signedPct(pct: number): string {
  const r = Math.round(pct);
  return r > 0 ? `+${r}%` : r < 0 ? `−${Math.abs(r)}%` : "0%";
}

/** The window a tile shows: 30 days if there's enough data, else 90, else none. */
export function tileWindow(trend: Trend | null | undefined): { days: WindowDays; w: TrendWindow } | null {
  if (trend?.["30"]) return { days: "30", w: trend["30"] };
  if (trend?.["90"]) return { days: "90", w: trend["90"] };
  return null;
}

/** Tile badge: "↑ 12%" (direction is also in the arrow, not colour alone). */
export function tileBadge(trend: Trend | null | undefined): { text: string; direction: TrendWindow["direction"]; title: string } | null {
  const t = tileWindow(trend);
  if (!t) return null;
  return {
    text: `${ARROW[t.w.direction]} ${Math.abs(Math.round(t.w.pct))}%`,
    direction: t.w.direction,
    title: `${WORD[t.w.direction]} ${signedPct(t.w.pct)} over ${t.days} days (sold prices)`,
  };
}

/** Sheet headline for a window, or why there's none. */
export function windowText(trend: Trend | null | undefined, days: WindowDays): string {
  const w = trend?.[days];
  if (!w) {
    return trend?.sales
      ? `Not enough sales yet for a ${days}-day trend (needs 5 in each of the last two ${days}-day periods).`
      : "No comparable sales yet.";
  }
  return `${WORD[w.direction]} ${signedPct(w.pct)}: median sold price ${days === "30" ? "this month" : "these 90 days"} vs the ${days} days before (${w.recent_sales} and ${w.prior_sales} sales).`;
}

export interface SparkGeometry {
  segments: string[]; // SVG polyline "x,y x,y" runs, broken at months without enough sales
  dots: { x: number; y: number; point: TrendPoint; last: boolean }[];
}

/** Positions for a sparkline of monthly medians in a w×h box (with a little padding). */
export function sparkGeometry(points: TrendPoint[], w: number, h: number, pad = 4): SparkGeometry {
  const values = points.map((p) => (p.median == null ? null : Number(p.median)));
  const known = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!known.length) return { segments: [], dots: [] };
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const span = hi - lo || 1;
  const step = points.length > 1 ? (w - 2 * pad) / (points.length - 1) : 0;
  const lastKnown = values.reduce<number>((acc, v, i) => (v != null ? i : acc), -1);
  const segments: string[] = [];
  const dots: SparkGeometry["dots"] = [];
  let run: string[] = [];
  values.forEach((v, i) => {
    if (v == null) {
      if (run.length > 1) segments.push(run.join(" "));
      run = [];
      return;
    }
    const x = round(pad + i * step);
    const y = round(hi === lo ? h / 2 : pad + (1 - (v - lo) / span) * (h - 2 * pad));
    run.push(`${x},${y}`);
    dots.push({ x, y, point: points[i]!, last: i === lastKnown });
  });
  if (run.length > 1) segments.push(run.join(" "));
  return { segments, dots };
}

const round = (n: number) => Math.round(n * 10) / 10;
