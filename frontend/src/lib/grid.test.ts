import { describe, expect, it } from "vitest";

import { estimateTileHeight, laneGeometry, laneLeft, lanesFor, nearEnd, recallGrid, rememberGrid } from "./grid";

describe("grid geometry", () => {
  it("uses 2 columns on phones up to 5 on wide screens", () => {
    expect([343, 600, 1000, 1300].map(lanesFor)).toEqual([2, 3, 4, 5]);
  });

  it("positions columns with the gap between them", () => {
    const g = laneGeometry(343); // iPhone: 375 - 2 * 16 gutters
    expect(g).toEqual({ lanes: 2, gap: 12, itemWidth: 165.5 });
    expect(laneLeft(1, g)).toBe(177.5);
    const desk = laneGeometry(1248);
    expect(desk.lanes).toBe(5);
    expect(laneLeft(4, desk) + desk.itemWidth).toBeCloseTo(1248);
  });

  it("estimates tile height from width", () => {
    expect(estimateTileHeight(165.5)).toBe(299);
  });

  it("asks for more within about two screens of the end", () => {
    expect(nearEnd(17, 30, 2)).toBe(true); // 30 - 1 - 2 * 6 = 17: about two screens early
    expect(nearEnd(16, 30, 2)).toBe(false);
    expect(nearEnd(0, 0, 2)).toBe(false);
  });

  it("remembers where a grid was", () => {
    rememberGrid("feed", 1234, [{ key: 1 }]);
    expect(recallGrid("feed")).toEqual({ offset: 1234, measurements: [{ key: 1 }] });
    expect(recallGrid("other")).toBeUndefined();
  });
});
