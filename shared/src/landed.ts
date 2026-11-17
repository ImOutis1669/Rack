import type { Landed } from "./types";
import { formatGBP } from "./format";

/** "≈ £240 delivered" for imports; null when there's nothing beyond the price to add. */
export function landedLabel(l: Landed | null): string | null {
  if (!l || !l.imported) return null;
  return `≈ ${formatGBP(l.total_gbp)} delivered`;
}

/** Breakdown lines for a tooltip / the gallery. */
export function landedLines(l: Landed | null): string[] {
  if (!l) return [];
  const lines: string[] = [];
  if (l.shipping_gbp != null) lines.push(`Postage ${formatGBP(l.shipping_gbp)}`);
  if (Number(l.vat_gbp) > 0) lines.push(`UK VAT ${formatGBP(l.vat_gbp)}`);
  if (Number(l.duty_gbp) > 0) lines.push(`Duty ${formatGBP(l.duty_gbp)}`);
  if (Number(l.fee_gbp) > 0) lines.push(`Courier fee ${formatGBP(l.fee_gbp)}`);
  return [...lines, ...l.notes.map((n) => n[0].toUpperCase() + n.slice(1))];
}

/** Strike-through price: the seller's original price, else the price when you saved it. */
export function previousPrice(item: {
  price_gbp: string | null;
  was_price_gbp: string | null;
  price_gbp_at_save: string | null;
}): number | null {
  const now = Number(item.price_gbp);
  if (!item.price_gbp || !Number.isFinite(now)) return null;
  for (const v of [item.was_price_gbp, item.price_gbp_at_save]) {
    if (v != null && Number(v) > now) return Number(v);
  }
  return null;
}
