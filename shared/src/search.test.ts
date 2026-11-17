import { describe, expect, it } from "vitest";
import { addRecent, huntFromSearch, cleanQuery, liveFinished, liveSummary, retryAfterSeconds, searchQueryString } from "./search";
import type { LiveSearch } from "./types";

describe("search", () => {
  it("cleans queries like the server", () => {
    expect(cleanQuery("  rick   owens ")).toBe("rick owens");
    expect(cleanQuery("a")).toBe("");
    expect(cleanQuery("!!")).toBe("");
    expect(cleanQuery("43")).toBe("43");
  });

  it("builds the query string", () => {
    const qs = new URLSearchParams(
      searchQueryString(
        { q: " margiela  tabi ", sort: "price_asc", sources: ["vinted", "ebay"], category: "shoes", size: " 43 ", maxPrice: 300 },
        "abc",
      ),
    );
    expect(qs.get("q")).toBe("margiela tabi");
    expect(qs.getAll("source")).toEqual(["vinted", "ebay"]);
    expect([qs.get("category"), qs.get("size"), qs.get("max_price"), qs.get("cursor")]).toEqual(["shoes", "43", "300", "abc"]);
    expect(qs.has("min_price")).toBe(false);
    const any = new URLSearchParams(searchQueryString({ q: "x1", sort: "best", sources: [], category: "any" }));
    expect(any.has("category")).toBe(false);
  });

  it("summarises a live search", () => {
    const s = { status: "done", results: { ebay: 12, vinted: "not set up", grailed: "failed" } } as unknown as LiveSearch;
    expect(liveSummary(s)).toBe("eBay 12 · Vinted off · Grailed failed");
    expect(liveFinished(s)).toBe(true);
    expect(liveFinished({ ...s, status: "running" })).toBe(false);
    expect(liveFinished(null)).toBe(false);
  });

  it("keeps recent searches short and unique", () => {
    expect(addRecent(["tabi", "geobasket"], "Geobasket")).toEqual(["Geobasket", "tabi"]);
    expect(addRecent(["a1"], "x")).toEqual(["a1"]);
    expect(addRecent(Array.from({ length: 8 }, (_, i) => `q${i}`), "new")).toHaveLength(8);
  });

  it("turns a search into a hunt", () => {
    const h = huntFromSearch({ q: " margiela tabi ", sort: "best", sources: ["vinted"], category: "shoes", size: "43", maxPrice: 300 });
    expect([h.name, h.query, h.category, h.max_price_gbp, h.sizes, h.sources]).toEqual([
      "margiela tabi", "margiela tabi", "shoes", 300, ["43"], ["vinted"],
    ]);
  });

  it("reads Retry-After", () => {
    expect(retryAfterSeconds("29")).toBe(29);
    expect(retryAfterSeconds(null)).toBeNull();
    expect(retryAfterSeconds("soon")).toBeNull();
  });
});
