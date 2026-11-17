import type { Category, TasteItem } from "../api/types";
import { formatGBP, SOURCE_LABEL } from "./format";
import { worth } from "./wardrobeValue";

export const CATEGORY_LABEL: Record<Category, string> = {
  any: "Any",
  tops: "Tops",
  trousers: "Trousers",
  shoes: "Shoes",
  outerwear: "Outerwear",
  accessories: "Accessories",
};

/** What the item is called: its name, else its description or label (null: unnamed). */
export function itemName(it: Pick<TasteItem, "name" | "text" | "note">): string | null {
  return it.name || it.text || it.note || null;
}

/** For labels and alt text, where something must be said. */
export function displayName(it: Pick<TasteItem, "name" | "text" | "note">): string {
  return itemName(it) ?? "Wardrobe item";
}

/** Tile value: your value, else the estimate (≈), else what you paid. Wardrobe only. */
export function tileValue(it: TasteItem): string | null {
  if (it.kind !== "wardrobe") return null;
  const w = worth(it);
  if (!w) return null;
  return `${w.basis === "estimate" ? "≈ " : ""}${formatGBP(w.pence / 100)}`;
}

/** "16 Nov 2026" from "2026-11-16" (no timezone shifts). */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export interface DetailRow {
  label: string;
  value: string;
}

/** The sheet's detail rows: only fields that have a value. */
export function detailRows(it: TasteItem): DetailRow[] {
  const category = it.category ?? (it.effective_category && it.effective_category !== "any" ? it.effective_category : null);
  const rows: (DetailRow | null)[] = [
    it.size ? { label: "Size", value: it.size } : null,
    category ? { label: "Category", value: CATEGORY_LABEL[category] } : null,
    it.purchase_price_gbp != null ? { label: "Paid", value: formatGBP(it.purchase_price_gbp) } : null,
    it.custom_value_gbp != null ? { label: "Your value", value: formatGBP(it.custom_value_gbp) } : null,
    it.purchase_date ? { label: "Purchased", value: formatDate(it.purchase_date) } : null,
    it.source ? { label: "Bought on", value: SOURCE_LABEL[it.source] ?? it.source } : null,
  ];
  return rows.filter((r): r is DetailRow => r != null);
}

/** Where the item came from: the original listing (kept after it's gone) or a pasted link. */
export function sourceLink(it: Pick<TasteItem, "listing_url" | "image_url">): { href: string; label: string } | null {
  if (it.listing_url) return { href: it.listing_url, label: "View original listing" };
  if (it.image_url) return { href: it.image_url, label: "View source" };
  return null;
}
