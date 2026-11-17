import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api/client";
import type { TasteItem } from "../api/types";
import { parsePrice } from "../lib/bought";
import { formatGBP, SOURCE_LABEL } from "../lib/format";
import { safeHref } from "../lib/safe";
import { signedPct, type WindowDays, windowText } from "../lib/trend";
import { cn } from "../lib/utils";
import { changeLabel, coverageLine, estimateText, wardrobeTotals } from "../lib/wardrobeValue";
import { NumberTicker } from "./magicui/number-ticker";
import { Sparkline } from "./Sparkline";
import { Button, Field, Input, Segmented } from "./ui";

/** Wardrobe tab header, kept minimal: worth now, the change, and what you paid. */
export function WardrobeSummary({ items }: { items: TasteItem[] }) {
  const t = wardrobeTotals(items);
  if (t.valued + t.estimated + t.atPaid === 0) {
    return <p className="mb-5 text-footnote text-muted">Open an item to add what you paid or its brand, and its value shows here.</p>;
  }
  const change = changeLabel(t);
  const up = (t.changePence ?? 0) > 0;
  const down = (t.changePence ?? 0) < 0;
  return (
    <section aria-label="Wardrobe value" className="mb-6">
      <p className="text-footnote text-muted">Worth now</p>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-largetitle font-bold">
          £<NumberTicker value={Math.round(t.worthPence / 100)} />
        </span>
        {change && (
          <span className={cn("tabular text-footnote font-semibold", up && "text-accent", down && "text-danger", !up && !down && "text-muted")}>
            {change}
          </span>
        )}
      </p>
      <p className="mt-0.5 text-caption text-muted">
        {t.changePence != null && <>Paid {formatGBP(t.paidPence / 100)} · </>}
        {coverageLine(t)}
      </p>
    </section>
  );
}

export function MoneyField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const bad = value !== "" && parsePrice(value) == null;
  return (
    <Field label={label} hint={bad ? "Enter pounds, like 180 or 180.50" : hint}>
      {(id) => (
        <div className="relative flex items-center gap-2">
          <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-body text-muted">£</span>
          <Input id={id} inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} className="pl-7 tabular" aria-invalid={bad} />
          {value !== "" && (
            <Button type="button" size="md" variant="plain" onClick={() => onChange("")} className="shrink-0">
              Clear
            </Button>
          )}
        </div>
      )}
    </Field>
  );
}

/** The estimate (with its closest matches) and the sold-price trend, for the item sheet. */
export function EstimateSection({ item, open }: { item: TasteItem; open: boolean }) {
  const [days, setDays] = useState<WindowDays>("30");
  const comps = useQuery({
    queryKey: ["comparables", item.id, item.estimate_at],
    queryFn: () => api.comparables(item.id),
    enabled: open && item.estimate_gbp != null,
  });
  if (item.kind !== "wardrobe") return null;
  return (
    <>
      <section aria-label="Estimate" className="space-y-3">
        <h3 className="px-1 text-footnote font-semibold text-muted">Estimated value</h3>
        <p className="px-1 text-footnote">{estimateText(item)}</p>
        {comps.data && comps.data.length > 0 && (
          <ul className="grid grid-cols-3 gap-2">
            {comps.data.map((c) => (
              <li key={c.id}>
                <a href={safeHref(c.url)} target="_blank" rel="noopener noreferrer" className="press block">
                  {c.image && <img src={c.image} alt={c.title} loading="lazy" className="aspect-square w-full rounded-photo bg-fill object-cover" />}
                  <span className="mt-1 block truncate text-caption">
                    <span className="tabular font-semibold">{formatGBP(c.price_gbp)}</span> ·{" "}
                    {c.sold_at
                      ? `sold ${new Date(c.sold_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                      : SOURCE_LABEL[c.source]}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      {item.trend && (
        <section aria-label="Sold-price trend" className="space-y-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <h3 className="text-footnote font-semibold text-muted">Sold-price trend</h3>
            <Segmented
              value={days}
              onChange={setDays}
              options={[
                ["30", "30 days"],
                ["90", "90 days"],
              ]}
            />
          </div>
          {item.trend[days] && (
            <p
              className={cn(
                "tabular px-1 text-title font-bold",
                item.trend[days]!.direction === "up" && "text-accent",
                item.trend[days]!.direction === "down" && "text-danger",
              )}
            >
              {signedPct(item.trend[days]!.pct)}
            </p>
          )}
          <p className="px-1 text-footnote text-muted">{windowText(item.trend, days)}</p>
          <Sparkline points={item.trend.points} />
          <p className="px-1 text-caption text-muted">Grailed sales, mostly in the US, converted to £. Treat it as a rough signal.</p>
        </section>
      )}
    </>
  );
}
