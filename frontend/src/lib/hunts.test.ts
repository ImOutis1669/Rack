import { describe, expect, it } from "vitest";
import { emptyHunt, huntFromListing, huntSummary } from "./hunts";

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
