import { describe, expect, it } from "vitest";

import { clearSnapshots, isDefaultFeed, loadSnapshot, MAX_AGE_MS, saveSnapshot } from "./snapshot";

function memory() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("snapshots", () => {
  it("round-trips, expires after 24 hours and clears", () => {
    const s = memory();
    saveSnapshot("feed", { items: [1, 2] }, s, 1000);
    expect(loadSnapshot("feed", s, 1000 + MAX_AGE_MS)).toEqual({ items: [1, 2] });
    expect(loadSnapshot("feed", s, 1001 + MAX_AGE_MS)).toBeUndefined();
    expect(s.m.size).toBe(0); // the expired one is removed
    saveSnapshot("saved", [3], s, 0);
    clearSnapshots(s);
    expect(loadSnapshot("saved", s, 0)).toBeUndefined();
  });

  it("survives broken or missing storage", () => {
    const s = memory();
    s.setItem("rack.snap.feed", "{not json");
    expect(loadSnapshot("feed", s)).toBeUndefined();
    expect(loadSnapshot("feed", null)).toBeUndefined();
    expect(() => saveSnapshot("feed", 1, null)).not.toThrow();
  });

  it("only keeps the default feed view", () => {
    const base = { sort: "best", sources: [], maxPrice: null, category: null, brand: "" };
    expect(isDefaultFeed(base, false)).toBe(true);
    expect(isDefaultFeed(base, true)).toBe(false);
    expect(isDefaultFeed({ ...base, sort: "newest" }, false)).toBe(false);
    expect(isDefaultFeed({ ...base, sources: ["ebay"] }, false)).toBe(false);
    expect(isDefaultFeed({ ...base, brand: "Rick" }, false)).toBe(false);
  });
});
