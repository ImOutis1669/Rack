import { describe, expect, it } from "vitest";

import { INSTANT, pillTransition, SHEET_SPRING, SPRING } from "./motion";

describe("springs", () => {
  it("are critically damped by default, with a little bounce only for sheets", () => {
    expect(SPRING).toEqual({ type: "spring", bounce: 0, duration: 0.35 });
    expect(SHEET_SPRING).toMatchObject({ type: "spring", bounce: 0.2 });
  });

  it("slides the tab pill unless reduced motion is on", () => {
    expect(pillTransition(false)).toBe(SPRING);
    expect(pillTransition(null)).toBe(SPRING);
    expect(pillTransition(true)).toBe(INSTANT);
  });
});
