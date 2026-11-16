import { describe, expect, it } from "vitest";

import { sellerHide } from "./seller";

describe("sellerHide", () => {
  it("offers hiding a named seller", () => {
    expect(sellerHide({ source: "vinted", seller: { name: "bob", rating: null, count: null } })).toEqual({
      available: true,
      name: "bob",
    });
  });

  it("explains why eBay sellers can't be hidden, even if a name slipped through", () => {
    expect(sellerHide({ source: "ebay", seller: null })).toEqual({
      available: false,
      reason: "eBay seller names aren't stored",
    });
    expect(sellerHide({ source: "ebay", seller: { name: "x", rating: null, count: null } })?.available).toBe(false);
  });

  it("shows nothing when another source has no seller name", () => {
    expect(sellerHide({ source: "grailed", seller: null })).toBeNull();
  });
});
