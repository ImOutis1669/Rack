// Double-tap detection for the zoomable photos. Only quick one-finger taps count: lifting two
// fingers after a pinch also ends two touches in quick succession, and treating that as a
// double-tap zoomed the photo straight back in (iOS step 5 bug).

export const TAP_MAX_MS = 250; // finger down to up
export const DOUBLE_TAP_MS = 300; // first tap up to second tap up
export const TAP_SLOP = 10; // pt the finger may move and still be a tap

export class DoubleTap {
  private down: { x: number; y: number; t: number } | null = null;
  private multi = false;
  private lastTap: { x: number; y: number; t: number } | null = null;

  /** A finger went down; `touches` = fingers now on the screen. */
  start(touches: number, x: number, y: number, t: number): void {
    if (touches > 1) {
      this.multi = true; // a pinch: nothing in this gesture is a tap
      this.down = null;
      this.lastTap = null;
      return;
    }
    if (!this.multi) this.down = { x, y, t };
  }

  /** A finger lifted; `touches` = fingers still down. True when this completes a double-tap. */
  end(touches: number, x: number, y: number, t: number): boolean {
    if (this.multi) {
      if (touches === 0) this.multi = false;
      return false;
    }
    const d = this.down;
    this.down = null;
    if (!d || t - d.t > TAP_MAX_MS || Math.hypot(x - d.x, y - d.y) > TAP_SLOP) {
      this.lastTap = null;
      return false;
    }
    const prev = this.lastTap;
    if (prev && t - prev.t <= DOUBLE_TAP_MS && Math.hypot(x - prev.x, y - prev.y) <= TAP_SLOP * 4) {
      this.lastTap = null;
      return true;
    }
    this.lastTap = { x, y, t };
    return false;
  }
}
