import { describe, expect, it } from "vitest";
import { emptyHunt, FRIEND_MIN_INTERVAL, huntFromListing, huntSummary, intervalsFor, sizesHint, withinLimits } from "./hunts";

describe("huntFromListing", () => {
  it("uses brand plus distinctive title words and a 20% price margin", () => {
    const h = huntFromListing({
      brand: "Rick Owens",
      title: "Rick Owens Geobasket 43 black leather",
      category: "shoes",
      price_gbp: "250.00",
    });
    expect(h.query).toBe("Rick Owens Geobasket black");
    expect(h.category).toBe("shoes");
    expect(h.max_price_gbp).toBe(300);
  });

  it("copes with no brand or price", () => {
    const h = huntFromListing({ brand: null, title: "Vintage wool overcoat", category: null, price_gbp: null });
    expect(h.query).toBe("Vintage wool");
    expect(h.category).toBe("any");
    expect(h.max_price_gbp).toBeNull();
  });
});

describe("huntSummary", () => {
  it("lists the active filters", () => {
    expect(huntSummary({ ...emptyHunt(), query: "lemaire", category: "trousers", max_price_gbp: 200, sizes: ["32"] })).toBe(
      "“lemaire” · trousers · ≤ £200 · size 32 · all free sources · every 30 min",
    );
  });
});

describe("strict sizing (feature 6)", () => {
  it("starts off and says so in the summary when on", () => {
    expect(emptyHunt().strict_size).toBe(false);
    const h = { ...emptyHunt(), query: "geobasket", sizes: ["43", "UK 9"], strict_size: true };
    expect(huntSummary(h)).toContain("size 43/UK 9 (must match)");
    expect(huntSummary({ ...h, strict_size: false })).not.toContain("must match");
  });

  it("explains what the switch does", () => {
    expect(sizesHint(true, true)).toMatch(/^Only listings with one of these sizes/);
    expect(sizesHint(false, true)).toMatch(/^Listings with no size still match/);
    expect(sizesHint(true, false)).toMatch(/^Add sizes to filter by size/);
  });
});

describe("friends' hunt limits (v2.1)", () => {
  it("offers friends hourly or slower only, and raises a faster prefill", () => {
    expect(intervalsFor(true).map(([m]) => m)).toContain(5);
    expect(intervalsFor(false).every(([m]) => m >= FRIEND_MIN_INTERVAL)).toBe(true);
    expect(withinLimits({ ...emptyHunt(), interval_minutes: 30 }, false).interval_minutes).toBe(60);
    expect(withinLimits({ ...emptyHunt(), interval_minutes: 30 }, true).interval_minutes).toBe(30);
    expect(withinLimits({ ...emptyHunt(), interval_minutes: 180 }, false).interval_minutes).toBe(180);
  });
});
