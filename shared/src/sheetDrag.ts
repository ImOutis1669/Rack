/**
 * Swipe-down-to-close for sheets: the pure decisions, kept apart from the DOM so they're tested.
 * See .claude/skills/rack-apple-design/motion-and-materials.md §6 (momentum projection).
 */

/** Apple's projection: how far a release velocity (px/s) carries before it decays to rest. */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Distance the projected end point must pass to close: half the sheet, at most 320px. */
export function dismissThreshold(sheetHeight: number): number {
  return Math.min(sheetHeight * 0.5, 320);
}

/**
 * Close when the gesture is heading past the threshold: a long drag, or a short fast flick.
 * A release moving up (negative velocity) projects back up, so it stays open.
 */
export function shouldDismiss(offset: number, velocity: number, sheetHeight: number): boolean {
  if (offset <= 0) return false;
  return offset + project(velocity) > dismissThreshold(sheetHeight);
}

/** Dragging up past the resting point: give way less and less (rubber band), like iOS. */
export function resist(offset: number): number {
  if (offset >= 0) return offset;
  return -Math.min(24, Math.sqrt(-offset) * 2.2);
}

export const SLOP = 6; // px of movement before deciding what the gesture is

export type DragStart = {
  /** started on the grabber / header (always drags) rather than the content */
  fromHeader: boolean;
  /** some scrollable area under the finger is scrolled down (then the scroll wins) */
  scrolledDown: boolean;
  /** inside an element marked data-sheet-no-drag (e.g. a zoomable photo) */
  noDrag: boolean;
  touches: number;
};

/**
 * Decide on the first movement past the slop: drag the sheet only for a single finger moving
 * mostly down, from the header, or from content that is scrolled to the top. Horizontal moves
 * (photo swiping), pinches and scrolled content are left to the browser.
 */
export function decide(start: DragStart, dx: number, dy: number): "drag" | "ignore" | "wait" {
  if (start.touches > 1 || start.noDrag) return "ignore";
  if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return "wait";
  if (Math.abs(dx) > Math.abs(dy)) return "ignore";
  if (start.fromHeader) return "drag";
  if (dy <= 0 || start.scrolledDown) return "ignore";
  return "drag";
}

/** Release velocity (px/s) from recent samples, using the last ~100 ms. */
export function releaseVelocity(samples: { t: number; y: number }[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (let i = samples.length - 1; i >= 0; i--) {
    first = samples[i];
    if (last.t - samples[i].t >= 100) break;
  }
  const dt = last.t - first.t;
  return dt > 0 ? ((last.y - first.y) / dt) * 1000 : 0;
}
