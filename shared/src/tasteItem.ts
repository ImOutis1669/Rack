import type { Category, TasteItem } from "./types";
import { defaultPrice, parsePrice } from "./bought";
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

/** Status shown on the photo while the item is still being read, or if its photo is missing. */
export function photoState(it: TasteItem): string | null {
  if (it.photo_missing) return "Photo couldn't be copied";
  if (it.embed_error) return "Couldn't read";
  return it.embedded ? null : "Learning";
}

/** The item sheet's edit form (web and iOS). */
export interface Draft {
  name: string;
  brand: string;
  size: string;
  category: "" | Exclude<Category, "any">;
  paid: string;
  worth: string;
  date: string;
  note: string;
}

export function draftFrom(it: TasteItem): Draft {
  return {
    name: it.name ?? itemName(it) ?? "",
    brand: it.brand ?? "",
    size: it.size ?? "",
    category: it.category ?? "",
    paid: defaultPrice(it.purchase_price_gbp),
    worth: defaultPrice(it.custom_value_gbp),
    date: it.purchase_date ?? "",
    note: it.note ?? "",
  };
}

/** The edit form's problems, by field ("" = fine). */
export function draftErrors(d: Draft, today = new Date().toISOString().slice(0, 10)): Partial<Record<keyof Draft, string>> {
  const out: Partial<Record<keyof Draft, string>> = {};
  if (d.paid && parsePrice(d.paid) == null) out.paid = "Enter pounds, like 180 or 180.50";
  if (d.worth && parsePrice(d.worth) == null) out.worth = "Enter pounds, like 180 or 180.50";
  if (d.date && (d.date < "1950-01-01" || d.date > today)) out.date = "Pick a date up to today";
  return out;
}

/** The PATCH body for a draft (empty fields clear; money only for wardrobe items). */
export function patchFrom(d: Draft, kind: TasteItem["kind"]) {
  const blank = (s: string) => s.trim() || null;
  return {
    name: blank(d.name),
    brand: blank(d.brand),
    size: blank(d.size),
    category: d.category || null,
    note: blank(d.note),
    ...(kind === "wardrobe"
      ? {
          purchase_price_gbp: d.paid ? parsePrice(d.paid) : null,
          custom_value_gbp: d.worth ? parsePrice(d.worth) : null,
          purchase_date: d.date || null,
        }
      : {}),
  };
}
