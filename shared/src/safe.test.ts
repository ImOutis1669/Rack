import { describe, expect, it } from "vitest";
import { safeHref } from "./safe";

describe("safeHref", () => {
  it("keeps http(s) links", () => {
    expect(safeHref("https://www.vinted.co.uk/items/1")).toBe("https://www.vinted.co.uk/items/1");
    expect(safeHref("http://example.com/a")).toBe("http://example.com/a");
  });
  it("drops script and other schemes", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref(" JaVaScRiPt:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,<b>x</b>")).toBeUndefined();
    expect(safeHref("/relative")).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
  });
});
