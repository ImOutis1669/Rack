import { useState } from "react";
import type { TrendPoint } from "../api/types";
import { formatGBP } from "../lib/format";
import { sparkGeometry } from "../lib/trend";

const W = 240;
const H = 56;

function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

function readout(p: TrendPoint): string {
  return `${formatGBP(p.median)} median · 30 days to ${monthLabel(p.end)} · ${p.sales} sale${p.sales === 1 ? "" : "s"}`;
}

/**
 * Monthly median sold prices (oldest left). Muted line, latest month in the accent; months with
 * too few sales are gaps. Hover or focus a month for its numbers; the list below is the table view.
 */
export function Sparkline({ points }: { points: TrendPoint[] }) {
  const g = sparkGeometry(points, W, H, 6);
  const [active, setActive] = useState<number | null>(null);
  if (!g.dots.length) return null;
  const shown = active != null ? g.dots[active] : g.dots[g.dots.length - 1];
  return (
    <figure className="space-y-1.5">
      <p className="tabular min-h-5 text-caption text-muted" aria-live="polite">
        {shown ? readout(shown.point) : ""}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-14 w-full overflow-visible text-subtle"
        role="img"
        aria-label="Median sold price by month over the last 6 months"
        onPointerLeave={() => setActive(null)}
      >
        {g.segments.map((pts) => (
          <polyline key={pts} points={pts} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {g.dots.map((d, i) => (
          <g key={d.point.end}>
            {/* hit target bigger than the mark */}
            <rect
              x={d.x - 14}
              y={0}
              width={28}
              height={H}
              fill="transparent"
              tabIndex={0}
              aria-label={readout(d.point)}
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className="cursor-default outline-none"
            />
            <circle
              cx={d.x}
              cy={d.y}
              r={d.last || active === i ? 4 : 2.5}
              className={d.last ? "fill-accent" : "fill-current"}
              stroke="var(--background)"
              strokeWidth={active === i ? 2 : 0}
              pointerEvents="none"
            />
          </g>
        ))}
      </svg>
      <details className="text-caption text-muted">
        <summary className="cursor-pointer">Monthly medians</summary>
        <ul className="tabular mt-1 space-y-0.5">
          {points.map((p) => (
            <li key={p.end}>
              30 days to {monthLabel(p.end)}: {p.median ? formatGBP(p.median) : "too few sales"} ({p.sales})
            </li>
          ))}
        </ul>
      </details>
    </figure>
  );
}
