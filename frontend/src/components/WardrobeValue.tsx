import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { TasteItem } from "../api/types";
import { defaultPrice, parsePrice } from "../lib/bought";
import { cn } from "../lib/utils";
import { changeLabel, coverageLine, wardrobeTotals } from "../lib/wardrobeValue";
import { NumberTicker } from "./magicui/number-ticker";
import { Button, Field, Input, Sheet } from "./ui";

/** Wardrobe tab header: what you paid in total and what it's worth now. */
export function WardrobeSummary({ items }: { items: TasteItem[] }) {
  const t = wardrobeTotals(items);
  if (t.valued + t.atPaid === 0) {
    return (
      <p className="mb-5 rounded-group bg-surface p-4 text-footnote text-muted dark:bg-elevated">
        Add what you paid to see your wardrobe's value. Tap “Add price” under an item.
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
            £<NumberTicker value={Math.round(t.paidPence / 100)} />
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
  useEffect(() => {
    if (!open) return;
    setPaid(defaultPrice(item.purchase_price_gbp));
    setWorth(defaultPrice(item.custom_value_gbp));
  }, [open, item.purchase_price_gbp, item.custom_value_gbp]);
  const ok = (v: string) => v === "" || parsePrice(v) != null;
  const save = useMutation({
    mutationFn: () =>
      api.patchTaste(item.id, {
        purchase_price_gbp: paid === "" ? null : parsePrice(paid),
        custom_value_gbp: worth === "" ? null : parsePrice(worth),
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
        <MoneyField label="Worth now" value={worth} onChange={setWorth} hint="Leave empty to count it at what you paid." />
        {save.isError && <p className="text-footnote text-danger">{String((save.error as Error).message)}</p>}
      </form>
    </Sheet>
  );
}
