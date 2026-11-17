// Search across all sources (v2.1): query strings and the small rules both apps share.
import { emptyHunt } from "./hunts";
import type { Category, HuntInput, LiveSearch, SearchParams } from "./types";

export const MIN_QUERY = 2;

/** Same idea as the server's clean_query: trimmed, single spaces; "" when too short. */
export function cleanQuery(raw: string): string {
  const q = raw.replace(/\s+/g, " ").trim().slice(0, 100);
  return q.replace(/[^\p{L}\p{N}]/gu, "").length >= MIN_QUERY ? q : "";
}

export function searchQueryString(p: SearchParams, cursor?: string | null): string {
  const q = new URLSearchParams({ q: cleanQuery(p.q), sort: p.sort, limit: "30" });
  for (const s of p.sources) q.append("source", s);
  if (p.category && p.category !== "any") q.set("category", p.category);
  if (p.size?.trim()) q.set("size", p.size.trim());
  if (p.minPrice != null) q.set("min_price", String(p.minPrice));
  if (p.maxPrice != null) q.set("max_price", String(p.maxPrice));
  if (cursor) q.set("cursor", cursor);
  return q.toString();
}

export const liveFinished = (s: LiveSearch | null | undefined): boolean =>
  !!s && (s.status === "done" || s.status === "error");

const SOURCE_NAME: Record<string, string> = { ebay: "eBay", vinted: "Vinted", grailed: "Grailed" };

/** "eBay 12 · Vinted 3 · Grailed failed" */
export function liveSummary(s: LiveSearch): string {
  return Object.entries(s.results)
    .map(([src, v]) => `${SOURCE_NAME[src] ?? src} ${typeof v === "number" ? v : v === "not set up" ? "off" : "failed"}`)
    .join(" · ");
}

/** Remembered searches (device only): newest first, no duplicates, at most `max`. */
export function addRecent(list: string[], q: string, max = 8): string[] {
  const clean = cleanQuery(q);
  if (!clean) return list;
  return [clean, ...list.filter((x) => x.toLowerCase() !== clean.toLowerCase())].slice(0, max);
}

/** Seconds to wait from a 429's Retry-After header value (null if it isn't a number). */
export function retryAfterSeconds(header: string | null): number | null {
  const n = header == null ? NaN : Number(header);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/** "Save as hunt" from a search: the query and filters become the hunt. */
export function huntFromSearch(p: SearchParams): HuntInput {
  const q = cleanQuery(p.q);
  return {
    ...emptyHunt(),
    name: q.slice(0, 60),
    query: q,
    category: (p.category ?? "any") as Category,
    max_price_gbp: p.maxPrice ?? null,
    sizes: p.size?.trim() ? [p.size.trim()] : [],
    sources: p.sources,
  };
}
