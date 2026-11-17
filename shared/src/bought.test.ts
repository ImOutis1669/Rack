import { describe, expect, it } from "vitest";

import { boughtLabel, defaultPrice, parsePrice } from "./bought";

describe("defaultPrice", () => {
  it("pre-fills the current £ price without needless pence", () => {
    expect(defaultPrice("185.00")).toBe("185");
    expect(defaultPrice("92.40")).toBe("92.40");
    expect(defaultPrice(null)).toBe("");
  });
});

describe("parsePrice", () => {
  it("accepts pounds with optional pence, £ and commas", () => {
    expect(parsePrice("180")).toBe("180.00");
    expect(parsePrice("180.5")).toBe("180.50");
    expect(parsePrice("£1,250.99")).toBe("1250.99");
    expect(parsePrice(" 0 ")).toBe("0.00");
  });

  it("rejects empty, negative, too precise or silly amounts", () => {
    for (const bad of ["", "-5", "12.345", "abc", "1e3", "100001"]) {
      expect(parsePrice(bad), bad).toBeNull();
    }
  });
});

describe("boughtLabel", () => {
  it("describes where it came from", () => {
    expect(boughtLabel({ source: "vinted", size: "L", purchased_at: "2026-11-16T10:00:00Z" })).toBe("Bought on Vinted · L");
    expect(boughtLabel({ source: null, size: null, purchased_at: "2026-11-16T10:00:00Z" })).toBe("Bought");
  });

  it("is nothing for items added by hand", () => {
    expect(boughtLabel({ source: null, size: null, purchased_at: null })).toBeNull();
  });
});
