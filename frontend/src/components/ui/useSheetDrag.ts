import { animate, type MotionValue, useMotionValue } from "motion/react";
import { type RefObject, useEffect, useRef } from "react";
import { SHEET_SPRING } from "../../lib/motion";
import { type DragStart, decide, releaseVelocity, resist, shouldDismiss } from "../../lib/sheetDrag";

/**
 * Swipe down to close a sheet, like iOS (v1.2). The panel follows the finger 1:1 from the
 * grabber/header, and from the content when it's scrolled to the top; on release it closes if
 * the gesture is heading far enough down (momentum projection, lib/sheetDrag.ts), otherwise it
 * springs back. Reduced motion: no spring, it just closes or snaps back.
 *
 * Native touch listeners (not pointer events): only a non-passive touchmove can stop iOS from
 * scrolling once we've decided the finger is dragging the sheet. Horizontal swipes (photos),
 * pinches, form fields, `data-sheet-no-drag` areas and scrolled content are left alone.
 */
export function useSheetDrag(
  open: boolean,
  panel: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  reduce: boolean,
): MotionValue<number> {
  const y = useMotionValue(0);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    y.jump(0);
    const el = panel.current;
    if (!el) return;

    let start: DragStart | null = null;
    let x0 = 0;
    let y0 = 0;
    let state: "wait" | "drag" | "ignore" = "ignore";
    let samples: { t: number; y: number }[] = [];

    const scrolledDown = (target: EventTarget | null): boolean => {
      for (let n = target as HTMLElement | null; n && n !== el.parentElement; n = n.parentElement) {
        if (n.scrollTop > 0) {
          const oy = getComputedStyle(n).overflowY;
          if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return true;
        }
      }
      return false;
    };

    const onStart = (e: TouchEvent) => {
      const t = e.target as HTMLElement;
      start = {
        fromHeader: !!t.closest("[data-sheet-header]"),
        scrolledDown: scrolledDown(t),
        noDrag: !!t.closest("[data-sheet-no-drag], input, textarea, select, [contenteditable='true']"),
        touches: e.touches.length,
      };
      if (e.touches.length > 1 && state === "drag") settle(0); // a second finger: pinch, give up
      if (e.touches.length > 1) {
        state = "ignore";
        return;
      }
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      state = "wait";
      samples = [];
    };

    const onMove = (e: TouchEvent) => {
      if (!start || state === "ignore") return;
      if (e.touches.length > 1) {
        if (state === "drag") settle(0);
        state = "ignore";
        return;
      }
      const dx = e.touches[0].clientX - x0;
      const dy = e.touches[0].clientY - y0;
      if (state === "wait") {
        const next = decide(start, dx, dy);
        if (next === "wait") {
          // iOS commits to scrolling on the first uncancelled move: hold it while a downward
          // pull from the top (nothing to scroll that way) is still undecided.
          const likely = dy > 0 && Math.abs(dy) >= Math.abs(dx) && !start.noDrag;
          if (likely && (start.fromHeader || !start.scrolledDown)) e.preventDefault();
          return;
        }
        state = next;
        if (state === "ignore") return;
        y0 = e.touches[0].clientY; // follow the finger from here, 1:1
      }
      e.preventDefault();
      const offset = resist(e.touches[0].clientY - y0);
      y.set(offset);
      samples.push({ t: e.timeStamp, y: offset });
      if (samples.length > 20) samples.shift();
    };

    const settle = (velocity: number) => {
      const height = el.getBoundingClientRect().height;
      if (shouldDismiss(y.get(), velocity, height)) {
        if (reduce) {
          dismissRef.current();
          return;
        }
        void animate(y, height + 40, { type: "spring", bounce: 0, duration: 0.3, velocity }).then(() =>
          dismissRef.current(),
        );
      } else if (reduce) {
        y.set(0);
      } else {
        void animate(y, 0, { ...SHEET_SPRING, velocity });
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (state === "drag" && e.touches.length === 0) settle(releaseVelocity(samples));
      if (e.touches.length === 0) {
        state = "ignore";
        start = null;
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [open, panel, reduce, y]);

  return y;
}
