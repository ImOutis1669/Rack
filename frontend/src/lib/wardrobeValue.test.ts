import { describe, expect, it } from "vitest";

import { changeLabel, coverageLine, toPence, valueLine, wardrobeTotals } from "./wardrobeValue";

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
