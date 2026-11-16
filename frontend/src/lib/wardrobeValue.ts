import type { TasteItem } from "../api/types";
import { formatGBP } from "./format";

type Priced = Pick<TasteItem, "purchase_price_gbp" | "custom_value_gbp">;

/** "180.50" -> 18050 pence (null when missing or not a number). Sums stay exact in pence. */
export function toPence(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export interface WardrobeTotals {
  paidPence: number;
  worthPence: number;
  /** worth - paid over the items that have a price paid (null if none) */
  changePence: number | null;
  changePct: number | null;
  valued: number; // a value you typed in
  atPaid: number; // no value yet: counted at what you paid
  unpriced: number; // neither
  total: number;
}

/**
 * Paid = sum of prices paid. Worth now = your value where you gave one, else what you paid
 * (items with neither aren't counted). The change compares like with like: only items that have
 * a price paid.
 */
export function wardrobeTotals(items: Priced[]): WardrobeTotals {
  let paidPence = 0;
  let worthPence = 0;
  let worthOfPaid = 0;
  let valued = 0;
  let atPaid = 0;
  let unpriced = 0;
  let withPaid = 0;
  for (const it of items) {
    const paid = toPence(it.purchase_price_gbp);
    const value = toPence(it.custom_value_gbp);
    if (paid != null) {
      paidPence += paid;
      withPaid += 1;
    }
    if (value != null) {
      worthPence += value;
      valued += 1;
      if (paid != null) worthOfPaid += value;
    } else if (paid != null) {
      worthPence += paid;
      worthOfPaid += paid;
      atPaid += 1;
    } else {
      unpriced += 1;
    }
  }
  const changePence = withPaid ? worthOfPaid - paidPence : null;
  const changePct = changePence != null && paidPence > 0 ? (changePence / paidPence) * 100 : null;
  return { paidPence, worthPence, changePence, changePct, valued, atPaid, unpriced, total: items.length };
}

/** "1 valued by you · 2 counted at what you paid · 2 without a price" */
export function coverageLine(t: WardrobeTotals): string {
  return [
    t.valued && `${t.valued} valued by you`,
    t.atPaid && `${t.atPaid} counted at what you paid`,
    t.unpriced && `${t.unpriced} without a price`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "+£80 (+6%)", "−£40 (−3%)", "£0 (0%)" */
export function changeLabel(t: WardrobeTotals): string | null {
  if (t.changePence == null) return null;
  const sign = t.changePence > 0 ? "+" : t.changePence < 0 ? "−" : "";
  const money = `${sign}${formatGBP(Math.abs(t.changePence) / 100)}`;
  if (t.changePct == null) return money;
  const pct = Math.round(Math.abs(t.changePct));
  return `${money} (${pct === 0 ? "" : sign}${pct}%)`;
}

/** Tile line: "Paid £180 · Worth £220", "Paid £180", "Worth £220" or "Add price". */
export function valueLine(it: Priced): string {
  const paid = toPence(it.purchase_price_gbp);
  const value = toPence(it.custom_value_gbp);
  const parts = [
    paid != null && `Paid ${formatGBP(paid / 100)}`,
    value != null && `Worth ${formatGBP(value / 100)}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Add price";
}
