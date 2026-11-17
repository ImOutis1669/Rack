import { describe, expect, it } from "vitest";

import { menuPosition } from "./index";

// Menus are portalled and fixed (v1.2): inside the feed's sideways-scrolling chip row the sort
// menu used to be clipped to the row's 36px height, so tapping "For you" seemed to do nothing.
describe("menu placement", () => {
  const vw = 375;
  const vh = 812;

  it("opens below the button, 4px under it", () => {
    const pos = menuPosition({ top: 56, bottom: 92, left: 16, right: 127 }, 4, "left", vw, vh);
    expect(pos).toEqual({ up: false, style: { top: 96, left: 16 } });
  });

  it("aligns its right edge with a right-aligned button", () => {
    const pos = menuPosition({ top: 400, bottom: 444, left: 300, right: 344 }, 2, "right", vw, vh);
    expect(pos.style).toEqual({ top: 448, right: 31 });
  });

  it("opens upwards when there's no room below", () => {
    const pos = menuPosition({ top: 700, bottom: 744, left: 300, right: 344 }, 3, "right", vw, vh);
    expect(pos.up).toBe(true);
    expect(pos.style).toEqual({ bottom: vh - 700 + 4, right: 31 });
  });

  it("keeps clear of the screen edge", () => {
    expect(menuPosition({ top: 56, bottom: 92, left: 2, right: 40 }, 2, "left", vw, vh).style.left).toBe(8);
  });
});
