import type { TasteItem } from "./types";
import { formatGBP } from "./format";

type Priced = Pick<TasteItem, "purchase_price_gbp" | "custom_value_gbp" | "estimate_gbp" | "estimate_count">;

/** "180.50" -> 18050 pence (null when missing or not a number). Sums stay exact in pence. */
export function toPence(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export type Confidence = "high" | "medium" | "low";

/** Same bands as the backend (pricing/resale.py). */
export function confidence(count: number | null | undefined): Confidence | null {
  if (count == null) return null;
  if (count >= 10) return "high";
  if (count >= 5) return "medium";
  if (count >= 3) return "low";
  return null;
}

/** What an item counts as now: your value, else the estimate, else what you paid. */
export function worth(it: Priced): { pence: number; basis: "yours" | "estimate" | "paid" } | null {
  const yours = toPence(it.custom_value_gbp);
  if (yours != null) return { pence: yours, basis: "yours" };
  const est = toPence(it.estimate_gbp);
  if (est != null) return { pence: est, basis: "estimate" };
  const paid = toPence(it.purchase_price_gbp);
  return paid != null ? { pence: paid, basis: "paid" } : null;
}

export interface WardrobeTotals {
  paidPence: number;
  worthPence: number;
  /** worth - paid over the items that have a price paid (null if none) */
  changePence: number | null;
  changePct: number | null;
  valued: number; // a value you typed in
  estimated: number; // estimated from similar listings
  atPaid: number; // no value or estimate: counted at what you paid
  unpriced: number; // nothing to go on
  total: number;
}

/**
 * Paid = sum of prices paid. Worth now = your value, else the estimate, else what you paid (items
 * with none aren't counted). The change compares like with like: only items with a price paid.
 */
export function wardrobeTotals(items: Priced[]): WardrobeTotals {
  const t: WardrobeTotals = {
    paidPence: 0,
    worthPence: 0,
    changePence: null,
    changePct: null,
    valued: 0,
    estimated: 0,
    atPaid: 0,
    unpriced: 0,
    total: items.length,
  };
  let worthOfPaid = 0;
  let withPaid = 0;
  for (const it of items) {
    const paid = toPence(it.purchase_price_gbp);
    const w = worth(it);
    if (paid != null) {
      t.paidPence += paid;
      withPaid += 1;
    }
    if (!w) {
      t.unpriced += 1;
      continue;
    }
    t.worthPence += w.pence;
    if (paid != null) worthOfPaid += w.pence;
    if (w.basis === "yours") t.valued += 1;
    else if (w.basis === "estimate") t.estimated += 1;
    else t.atPaid += 1;
  }
  t.changePence = withPaid ? worthOfPaid - t.paidPence : null;
  t.changePct = t.changePence != null && t.paidPence > 0 ? (t.changePence / t.paidPence) * 100 : null;
  return t;
}

/** "1 valued by you · 2 estimated · 1 counted at what you paid · 1 without a price" */
export function coverageLine(t: WardrobeTotals): string {
  return [
    t.valued && `${t.valued} valued by you`,
    t.estimated && `${t.estimated} estimated`,
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

/** Tile line: "Paid £180 · Worth £220", "Paid £180 · ≈ £240", "≈ £240" or "Add price". */
export function valueLine(it: Priced): string {
  const paid = toPence(it.purchase_price_gbp);
  const w = worth(it);
  const parts = [
    paid != null && `Paid ${formatGBP(paid / 100)}`,
    w?.basis === "yours" && `Worth ${formatGBP(w.pence / 100)}`,
    w?.basis === "estimate" && `≈ ${formatGBP(w.pence / 100)}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Add price";
}

/** Sheet text for the estimate, or why there isn't one. */
export function estimateText(
  it: Pick<TasteItem, "estimate_gbp" | "estimate_count" | "estimate_at" | "image" | "estimate_kind">,
): string {
  if (!it.image) return "Estimates need a photo.";
  if (!it.estimate_at && it.estimate_gbp == null && it.estimate_count == null) return "Estimating…";
  if (it.estimate_count == null) return "Add the brand to get an estimate.";
  if (it.estimate_gbp == null) {
    return `Not enough similar listings yet (${it.estimate_count}). Rack keeps looking as new listings come in.`;
  }
  const c = confidence(it.estimate_count);
  const conf = c ? ` (${c} confidence)` : "";
  if (it.estimate_kind === "sold") {
    return `≈ ${formatGBP(it.estimate_gbp)} typical sold price, based on ${it.estimate_count} similar sale${
      it.estimate_count === 1 ? "" : "s"
    } on Grailed in the last 90 days${conf}.`;
  }
  return `≈ ${formatGBP(it.estimate_gbp)} typical asking price, based on ${it.estimate_count} similar listing${
    it.estimate_count === 1 ? "" : "s"
  }${conf}. Asking prices run higher than what things sell for.`;
}
