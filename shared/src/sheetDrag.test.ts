import { describe, expect, it } from "vitest";

import { decide, type DragStart, dismissThreshold, project, releaseVelocity, resist, shouldDismiss } from "./sheetDrag";

const start = (over: Partial<DragStart> = {}): DragStart => ({
  fromHeader: false,
  scrolledDown: false,
  noDrag: false,
  touches: 1,
  ...over,
});

describe("momentum projection", () => {
  it("uses Apple's exponential-decay form", () => {
    expect(project(1000)).toBeCloseTo(499, 0); // 1 px/ms carries ~499px at 0.998
    expect(project(0)).toBe(0);
    expect(project(-500)).toBeLessThan(0);
  });

  it("caps the distance for tall sheets", () => {
    expect(dismissThreshold(400)).toBe(200);
    expect(dismissThreshold(800)).toBe(320);
  });
});

describe("closing on release", () => {
  const h = 700; // a full-height sheet: threshold 320px

  it("closes after a long, slow drag", () => {
    expect(shouldDismiss(340, 0, h)).toBe(true);
  });

  it("springs back after a short, slow drag", () => {
    expect(shouldDismiss(120, 50, h)).toBe(false);
  });

  it("closes on a short fast flick down", () => {
    expect(shouldDismiss(60, 900, h)).toBe(true);
  });

  it("stays open when the finger was moving back up at release", () => {
    expect(shouldDismiss(250, -600, h)).toBe(false);
  });

  it("never closes from at or above the resting point", () => {
    expect(shouldDismiss(0, 3000, h)).toBe(false);
    expect(shouldDismiss(-10, 3000, h)).toBe(false);
  });
});

describe("deciding what the finger is doing", () => {
  it("waits inside the slop", () => {
    expect(decide(start(), 2, 3)).toBe("wait");
  });

  it("drags on a downward pull from content scrolled to the top", () => {
    expect(decide(start(), 1, 12)).toBe("drag");
  });

  it("leaves scrolled content to scroll", () => {
    expect(decide(start({ scrolledDown: true }), 0, 12)).toBe("ignore");
  });

  it("leaves upward moves in content to scroll", () => {
    expect(decide(start(), 0, -12)).toBe("ignore");
  });

  it("always drags from the grabber/header, even when content is scrolled", () => {
    expect(decide(start({ fromHeader: true, scrolledDown: true }), 0, 12)).toBe("drag");
  });

  it("leaves horizontal swipes (photos) alone", () => {
    expect(decide(start(), 14, 8)).toBe("ignore");
  });

  it("never fights a pinch or a no-drag area", () => {
    expect(decide(start({ touches: 2 }), 0, 20)).toBe("ignore");
    expect(decide(start({ noDrag: true }), 0, 20)).toBe("ignore");
  });
});

describe("feel", () => {
  it("follows the finger 1:1 downwards and resists upwards", () => {
    expect(resist(120)).toBe(120);
    expect(resist(-100)).toBeGreaterThan(-25);
    expect(resist(-100)).toBeLessThan(0);
  });

  it("measures release velocity over the last ~100ms", () => {
    const samples = [
      { t: 0, y: 0 },
      { t: 50, y: 10 },
      { t: 150, y: 60 },
      { t: 200, y: 110 },
    ];
    expect(releaseVelocity(samples)).toBeCloseTo(((110 - 10) / 150) * 1000, 0);
    expect(releaseVelocity([{ t: 0, y: 0 }])).toBe(0);
  });
});
