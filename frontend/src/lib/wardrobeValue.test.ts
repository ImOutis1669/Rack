import { describe, expect, it } from "vitest";

import { changeLabel, confidence, coverageLine, estimateText, toPence, valueLine, wardrobeTotals } from "./wardrobeValue";

const item = (paid: string | null, value: string | null) => ({ purchase_price_gbp: paid, custom_value_gbp: value });

describe("wardrobeTotals", () => {
  it("counts your value, else what you paid, and skips unpriced items", () => {
    const t = wardrobeTotals([
      item("500", "600"), // valued
      item("440", null), // at paid
      item("300", null), // at paid
      item(null, null), // unpriced
      item(null, null),
    ]);
    expect(t.paidPence).toBe(124_000);
    expect(t.worthPence).toBe(134_000);
    expect(t.changePence).toBe(10_000);
    expect(Math.round(t.changePct!)).toBe(8);
    expect([t.valued, t.atPaid, t.unpriced, t.total]).toEqual([1, 2, 2, 5]);
  });

  it("adds up in pence exactly", () => {
    const t = wardrobeTotals([item("0.10", null), item("0.20", null)]);
    expect(t.paidPence).toBe(30);
    expect(t.worthPence).toBe(30);
  });

  it("compares like with like: a value without a price paid is in worth but not the change", () => {
    const t = wardrobeTotals([item("100", "150"), item(null, "900")]);
    expect(t.worthPence).toBe(105_000);
    expect(t.changePence).toBe(5_000);
  });

  it("has no change without any price paid, and no % when everything was free", () => {
    expect(wardrobeTotals([item(null, "50")]).changePence).toBeNull();
    const free = wardrobeTotals([item("0", "20")]);
    expect(free.changePence).toBe(2_000);
    expect(free.changePct).toBeNull();
  });
});

describe("labels", () => {
  it("describes coverage and change", () => {
    const t = wardrobeTotals([item("500", "600"), item("440", null), item(null, null)]);
    expect(coverageLine(t)).toBe("1 valued by you · 1 counted at what you paid · 1 without a price");
    expect(changeLabel(t)).toBe("+£100 (+11%)");
    expect(changeLabel(wardrobeTotals([item("100", "70")]))).toBe("−£30 (−30%)");
    expect(changeLabel(wardrobeTotals([item("100", null)]))).toBe("£0 (0%)");
  });

  it("writes the tile line", () => {
    expect(valueLine(item("180", "220"))).toBe("Paid £180 · Worth £220");
    expect(valueLine(item("180", null))).toBe("Paid £180");
    expect(valueLine(item(null, "220"))).toBe("Worth £220");
    expect(valueLine(item(null, null))).toBe("Add price");
  });

  it("parses pence", () => {
    expect(toPence("180.50")).toBe(18050);
    expect(toPence(null)).toBeNull();
    expect(toPence("x")).toBeNull();
  });
});

describe("estimates (5b)", () => {
  const est = (paid: string | null, value: string | null, estimate: string | null, count: number | null) => ({
    purchase_price_gbp: paid,
    custom_value_gbp: value,
    estimate_gbp: estimate,
    estimate_count: count,
  });

  it("uses your value over the estimate, and the estimate over what you paid", () => {
    const t = wardrobeTotals([est("100", "150", "999", 12), est("200", null, "260", 8), est("50", null, null, 2)]);
    expect(t.worthPence).toBe(15_000 + 26_000 + 5_000);
    expect([t.valued, t.estimated, t.atPaid, t.unpriced]).toEqual([1, 1, 1, 0]);
    expect(t.changePence).toBe(11_000); // (150 + 260 + 50) - (100 + 200 + 50)
    expect(coverageLine(t)).toBe("1 valued by you · 1 estimated · 1 counted at what you paid");
  });

  it("counts an estimated item without a price paid in worth only", () => {
    const t = wardrobeTotals([est(null, null, "300", 5)]);
    expect([t.worthPence, t.changePence, t.estimated]).toEqual([30_000, null, 1]);
  });

  it("writes ≈ for estimates on the tile", () => {
    expect(valueLine(est("180", null, "240", 10))).toBe("Paid £180 · ≈ £240");
    expect(valueLine(est(null, null, "240", 3))).toBe("≈ £240");
    expect(valueLine(est("180", "220", "240", 10))).toBe("Paid £180 · Worth £220");
  });

  it("has confidence bands matching the backend", () => {
    expect([2, 3, 4, 5, 9, 10].map(confidence)).toEqual([null, "low", "low", "medium", "medium", "high"]);
    expect(confidence(null)).toBeNull();
  });

  it("explains the estimate or why there isn't one", () => {
    const base = { image: "/x.jpg", estimate_at: "2026-11-16T10:00:00Z" };
    expect(estimateText({ ...base, estimate_gbp: "700.00", estimate_count: 12 })).toBe(
      "≈ £700 typical asking price, based on 12 similar listings (high confidence). Asking prices run higher than what things sell for.",
    );
    expect(estimateText({ ...base, estimate_gbp: null, estimate_count: 2 })).toMatch(/^Not enough similar listings yet \(2\)/);
    expect(estimateText({ ...base, estimate_gbp: null, estimate_count: null })).toBe("Add the brand to get an estimate.");
    expect(estimateText({ ...base, image: null, estimate_gbp: null, estimate_count: null })).toBe("Estimates need a photo.");
    expect(estimateText({ image: "/x.jpg", estimate_at: null, estimate_gbp: null, estimate_count: null })).toBe("Estimating…");
  });
});
