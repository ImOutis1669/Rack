/** Masonry grid geometry for the virtualized listing grids (feed, Saved). */

/** Columns by container width, matching the old CSS columns (2 / 3 / 4 / 5). */
export function lanesFor(width: number): number {
  if (width >= 1216) return 5;
  if (width >= 960) return 4;
  if (width >= 576) return 3;
  return 2;
}

/** Horizontal gap: 12px on phones, 20px from tablet up. */
export function gapFor(width: number): number {
  return width >= 720 ? 20 : 12;
}

export interface Lanes {
  lanes: number;
  gap: number;
  itemWidth: number;
}

export function laneGeometry(width: number): Lanes {
  const lanes = lanesFor(width);
  const gap = gapFor(width);
  return { lanes, gap, itemWidth: Math.max(1, (width - gap * (lanes - 1)) / lanes) };
}

export function laneLeft(lane: number, g: Lanes): number {
  return lane * (g.itemWidth + g.gap);
}

/** First guess at a tile's height before it's measured: 4:5 photo + text + bottom margin. */
export function estimateTileHeight(itemWidth: number): number {
  return Math.round(itemWidth * 1.25 + 92);
}

/** Load the next page once the last rendered tile is within ~2 screens (rows) of the end. */
export function nearEnd(lastRendered: number, count: number, lanes: number, rows = 6): boolean {
  return count > 0 && lastRendered >= count - 1 - lanes * rows;
}

/**
 * Where a grid was scrolled to and its measured tile sizes, kept for this tab so going back to
 * the feed (from another tab) lands where you were.
 */
const memory = new Map<string, { offset: number; measurements: unknown[] }>();

export function rememberGrid(key: string, offset: number, measurements: unknown[]): void {
  memory.set(key, { offset, measurements });
}

export function recallGrid(key: string): { offset: number; measurements: unknown[] } | undefined {
  return memory.get(key);
}
