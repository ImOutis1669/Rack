import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { TasteItem } from "../api/types";
import { defaultPrice, parsePrice } from "../lib/bought";
import { formatGBP, SOURCE_LABEL } from "../lib/format";
import { safeHref } from "../lib/safe";
import { cn } from "../lib/utils";
import { changeLabel, coverageLine, estimateText, wardrobeTotals } from "../lib/wardrobeValue";
import { NumberTicker } from "./magicui/number-ticker";
import { signedPct, type WindowDays, windowText } from "../lib/trend";
import { Sparkline } from "./Sparkline";
import { Button, Field, Input, Segmented, Sheet } from "./ui";

/** Wardrobe tab header: what you paid in total and what it's worth now. */
export function WardrobeSummary({ items }: { items: TasteItem[] }) {
  const t = wardrobeTotals(items);
  if (t.valued + t.estimated + t.atPaid === 0) {
    return (
      <p className="mb-5 rounded-group bg-surface p-4 text-footnote text-muted dark:bg-elevated">
        Add what you paid, or a brand for an estimate, to see your wardrobe's value. Tap “Add price” under an item.
      </p>
    );
  }
  const change = changeLabel(t);
  const up = (t.changePence ?? 0) > 0;
  const down = (t.changePence ?? 0) < 0;
  return (
    <section aria-label="Wardrobe value" className="mb-5 rounded-group bg-surface p-4 dark:bg-elevated">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-footnote text-muted">Paid</p>
          <p className="font-display text-title font-bold">
            {t.changePence == null ? <span className="text-muted">–</span> : <>£<NumberTicker value={Math.round(t.paidPence / 100)} /></>}
          </p>
        </div>
        <div>
          <p className="text-footnote text-muted">Worth now</p>
          <p className="font-display text-title font-bold">
            £<NumberTicker value={Math.round(t.worthPence / 100)} />
          </p>
          {change && (
            <p className={cn("tabular text-footnote font-semibold", up && "text-accent", down && "text-danger", !up && !down && "text-muted")}>
              {change}
            </p>
          )}
        </div>
      </div>
      <p className="mt-3 text-caption text-muted">{coverageLine(t)}</p>
    </section>
  );
}

function MoneyField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
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

/** Edit an item's price paid and value now. Empty clears it. */
export function ValueSheet({ item, open, onClose, onSaved }: { item: TasteItem; open: boolean; onClose: () => void; onSaved: () => void }) {
  const [paid, setPaid] = useState("");
  const [worth, setWorth] = useState("");
  const [brand, setBrand] = useState("");
  const [days, setDays] = useState<WindowDays>("30");
  useEffect(() => {
    if (!open) return;
    setPaid(defaultPrice(item.purchase_price_gbp));
    setWorth(defaultPrice(item.custom_value_gbp));
    setBrand(item.brand ?? "");
  }, [open, item.purchase_price_gbp, item.custom_value_gbp, item.brand]);
  const comps = useQuery({
    queryKey: ["comparables", item.id, item.estimate_at],
    queryFn: () => api.comparables(item.id),
    enabled: open && item.estimate_gbp != null,
  });
  const ok = (v: string) => v === "" || parsePrice(v) != null;
  const save = useMutation({
    mutationFn: () =>
      api.patchTaste(item.id, {
        purchase_price_gbp: paid === "" ? null : parsePrice(paid),
        custom_value_gbp: worth === "" ? null : parsePrice(worth),
        brand: brand.trim() || null,
      }),
    onSuccess: () => {
      onClose();
      onSaved();
    },
  });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Price and value"
      footer={
        <Button variant="primary" size="lg" className="w-full" disabled={!ok(paid) || !ok(worth) || save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <form
        className="space-y-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok(paid) && ok(worth)) save.mutate();
        }}
      >
        <MoneyField label="Paid" value={paid} onChange={setPaid} />
        <MoneyField
          label="Worth now"
          value={worth}
          onChange={setWorth}
          hint={item.estimate_gbp != null ? "Leave empty to use the estimate below." : "Leave empty to count it at what you paid."}
        />
        <Field label="Brand" hint={!item.brand && item.estimate_brand ? `Estimated as ${item.estimate_brand} from its label.` : undefined}>
          {(id) => <Input id={id} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder={item.estimate_brand ?? "e.g. Rick Owens"} autoComplete="off" />}
        </Field>
        <section aria-label="Estimate" className="space-y-3 rounded-group bg-surface p-3 dark:bg-elevated">
          <p className="text-footnote">{estimateText(item)}</p>
          {comps.data && comps.data.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {comps.data.map((c) => (
                <li key={c.id}>
                  <a href={safeHref(c.url)} target="_blank" rel="noopener noreferrer" className="block">
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
          <section aria-label="Sold-price trend" className="space-y-3 rounded-group bg-surface p-3 dark:bg-elevated">
            <div className="flex items-center justify-between gap-3">
              <p className="text-footnote font-semibold">Sold-price trend</p>
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
                  "tabular font-display text-title font-bold",
                  item.trend[days]!.direction === "up" && "text-accent",
                  item.trend[days]!.direction === "down" && "text-danger",
                )}
              >
                {signedPct(item.trend[days]!.pct)}
              </p>
            )}
            <p className="text-footnote text-muted">{windowText(item.trend, days)}</p>
            <Sparkline points={item.trend.points} />
            <p className="text-caption text-muted">Grailed sales, mostly in the US, converted to £. Treat it as a rough signal.</p>
          </section>
        )}
        {save.isError && <p className="text-footnote text-danger">{String((save.error as Error).message)}</p>}
      </form>
    </Sheet>
  );
}
