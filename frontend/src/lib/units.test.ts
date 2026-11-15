import { describe, expect, it, vi } from "vitest";
import { feedQueryString } from "../api/client";
import { SeenBatcher } from "./seen";
import { formatLength, parseLengthCm, splitList } from "./units";

describe("parseLengthCm", () => {
  it("handles cm, inches and feet", () => {
    expect(parseLengthCm("86")).toBe(86);
    expect(parseLengthCm("86 cm")).toBe(86);
    expect(parseLengthCm('34"')).toBe(86.4);
    expect(parseLengthCm("34in")).toBe(86.4);
    expect(parseLengthCm("34", "in")).toBe(86.4);
    expect(parseLengthCm("6'4\"")).toBe(193);
    expect(parseLengthCm("")).toBeNull();
    expect(parseLengthCm("long")).toBeNull();
  });

  it("formats back in either unit", () => {
    expect(formatLength(86.4, "in")).toBe("34");
    expect(formatLength(86.4, "cm")).toBe("86.4");
    expect(formatLength(null, "cm")).toBe("");
  });
});

describe("splitList", () => {
  it("trims and drops empties", () => {
    expect(splitList(" fake, , rep ,dupe")).toEqual(["fake", "rep", "dupe"]);
  });
});

describe("feedQueryString", () => {
  it("includes ranking filters", () => {
    const q = new URLSearchParams(
      feedQueryString({
        sort: "best",
        sources: ["ebay"],
        maxPrice: null,
        category: "trousers",
        brand: " rick ",
        hideSeenBefore: "2026-11-15T10:00:00Z",
      }),
    );
    expect(q.get("sort")).toBe("best");
    expect(q.get("category")).toBe("trousers");
    expect(q.get("brand")).toBe("rick");
    expect(q.get("hide_seen_before")).toBe("2026-11-15T10:00:00Z");
    expect(q.has("new_since")).toBe(false);
  });
});

describe("SeenBatcher", () => {
  it("dedupes and retries failed sends", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const b = new SeenBatcher(send, 10_000);
    b.add(1);
    b.add(1);
    b.add(2);
    await b.flush();
    expect(send).toHaveBeenLastCalledWith([1, 2]);
    await b.flush();
    expect(send).toHaveBeenCalledTimes(2);
    b.add(1);
    await b.flush();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
