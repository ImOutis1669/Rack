import { describe, expect, it } from "vitest";
import type { Landed } from "../api/types";
import { landedLabel, landedLines, previousPrice } from "./landed";

const imported: Landed = {
  total_gbp: "240.48",
  shipping_gbp: "20.00",
  vat_gbp: "38.08",
  duty_gbp: "20.40",
  fee_gbp: "12.00",
  imported: true,
  notes: ["import VAT, duty and courier fee on delivery"],
};

describe("landed cost display", () => {
  it("labels imports only", () => {
    expect(landedLabel(imported)).toBe("≈ £240 delivered");
    expect(landedLabel({ ...imported, imported: false })).toBeNull();
    expect(landedLabel(null)).toBeNull();
  });
  it("breaks down the extras", () => {
    expect(landedLines(imported)).toEqual([
      "Postage £20",
      "UK VAT £38",
      "Duty £20",
      "Courier fee £12",
      "Import VAT, duty and courier fee on delivery",
    ]);
  });
});

describe("previousPrice", () => {
  it("prefers the seller's original price, then your saved price", () => {
    expect(previousPrice({ price_gbp: "150", was_price_gbp: "200", price_gbp_at_save: "180" })).toBe(200);
    expect(previousPrice({ price_gbp: "150", was_price_gbp: null, price_gbp_at_save: "180" })).toBe(180);
    expect(previousPrice({ price_gbp: "150", was_price_gbp: null, price_gbp_at_save: "150" })).toBeNull();
  });
});
