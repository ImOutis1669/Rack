import type { TasteItem } from "../api/types";
import { formatGBP, SOURCE_LABEL } from "./format";

export const MAX_PRICE_GBP = 100_000;

/** Pre-fill for "Price paid": the listing's current £ price, without needless pence. */
export function defaultPrice(priceGbp: string | null | undefined): string {
  if (!priceGbp) return "";
  const n = Number(priceGbp);
  if (!Number.isFinite(n) || n < 0) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** What the user typed as a price, as the API wants it ("180.50"), or null if it isn't one. */
export function parsePrice(input: string): string | null {
  const s = input.replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n <= MAX_PRICE_GBP ? n.toFixed(2) : null;
}

/** "Bought on Vinted · £180 · L" for a wardrobe item that came from a listing. */
export function boughtLabel(item: Pick<TasteItem, "source" | "purchase_price_gbp" | "size" | "purchased_at">): string | null {
  if (!item.purchased_at) return null;
  return [
    item.source ? `Bought on ${SOURCE_LABEL[item.source]}` : "Bought",
    item.purchase_price_gbp != null ? formatGBP(item.purchase_price_gbp) : null,
    item.size,
  ]
    .filter(Boolean)
    .join(" · ");
}
