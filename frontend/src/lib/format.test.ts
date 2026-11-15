import { describe, expect, it } from "vitest";
import { feedQueryString } from "../api/client";
import { formatGBP, sellerLabel, timeAgo } from "./format";

describe("formatGBP", () => {
  it("formats decimal strings", () => {
    expect(formatGBP("185.00")).toBe("£185");
    expect(formatGBP(1234.4)).toBe("£1,234");
  });
  it("handles missing values", () => {
    expect(formatGBP(null)).toBe("—");
    expect(formatGBP("abc")).toBe("—");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  it("buckets durations", () => {
    expect(timeAgo("2026-11-15T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-11-15T11:15:00Z", now)).toBe("45m ago");
    expect(timeAgo("2026-11-15T07:00:00Z", now)).toBe("5h ago");
    expect(timeAgo("2026-11-12T12:00:00Z", now)).toBe("3d ago");
    expect(timeAgo(null, now)).toBe("");
  });
});

describe("sellerLabel", () => {
  it("combines rating and count", () => {
    expect(sellerLabel(99.6, 1342)).toBe("99.6% (1342)");
    expect(sellerLabel(100, 87)).toBe("100% (87)");
    expect(sellerLabel(null, null)).toBeNull();
  });
});

describe("feedQueryString", () => {
  it("encodes filters and cursor", () => {
    const qs = feedQueryString({ sort: "price_asc", sources: ["ebay", "vinted"], maxPrice: 200 }, "abc");
    const p = new URLSearchParams(qs);
    expect(p.get("sort")).toBe("price_asc");
    expect(p.getAll("source")).toEqual(["ebay", "vinted"]);
    expect(p.get("max_price")).toBe("200");
    expect(p.get("cursor")).toBe("abc");
  });
});
