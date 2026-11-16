import type { Category, HuntInput, Listing } from "../api/types";

export const INTERVALS: [number, string][] = [
  [5, "every 5 min"],
  [15, "every 15 min"],
  [30, "every 30 min"],
  [60, "hourly"],
  [180, "every 3 h"],
  [1440, "daily"],
];

export function emptyHunt(): HuntInput {
  return {
    name: "",
    query: "",
    category: "any",
    max_price_gbp: null,
    sizes: [],
    strict_size: false,
    sources: [],
    min_score: null,
    interval_minutes: 30,
    enabled: true,
    notify: true,
  };
}

/** Prefill a hunt from a listing: brand + a few distinctive title words. */
export function huntFromListing(item: Pick<Listing, "brand" | "title" | "category" | "price_gbp">): HuntInput {
  const brand = (item.brand ?? "").trim();
  const brandWords = new Set(brand.toLowerCase().split(/\s+/));
  const words = item.title
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !brandWords.has(w.toLowerCase()) && !/^\d+$/.test(w))
    .slice(0, 2);
  const query = [brand, ...words].filter(Boolean).join(" ");
  const price = item.price_gbp ? Math.ceil(Number(item.price_gbp) * 1.2) : null;
  return {
    ...emptyHunt(),
    name: query.slice(0, 60),
    query,
    category: (item.category ?? "any") as Category,
    max_price_gbp: price,
  };
}

/** Hint under the Sizes field. */
export function sizesHint(strict: boolean, hasSizes: boolean): string {
  if (!hasSizes) return "Add sizes to filter by size. Listings with no size still match.";
  return strict
    ? "Only listings with one of these sizes. UK, EU and US shoe sizes are compared (UK 9 = EU 43)."
    : "Listings with no size still match. UK, EU and US shoe sizes are compared (UK 9 = EU 43).";
}

export function huntSummary(h: HuntInput): string {
  const bits = [`“${h.query}”`];
  if (h.category !== "any") bits.push(h.category);
  if (h.max_price_gbp != null) bits.push(`≤ £${Number(h.max_price_gbp)}`);
  if (h.sizes.length) bits.push(`size ${h.sizes.join("/")}${h.strict_size ? " (must match)" : ""}`);
  bits.push(h.sources.length ? h.sources.join(", ") : "all free sources");
  bits.push(INTERVALS.find(([m]) => m === h.interval_minutes)?.[1] ?? `every ${h.interval_minutes} min`);
  return bits.join(" · ");
}
