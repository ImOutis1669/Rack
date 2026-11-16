import type { Transition } from "motion/react";

/**
 * Springs in Apple's terms (see .claude/skills/rack-apple-design): critically damped by default,
 * a little bounce only for things a gesture throws (sheets). Reduced motion: no movement.
 */
export const SPRING: Transition = { type: "spring", bounce: 0, duration: 0.35 };
export const SHEET_SPRING: Transition = { type: "spring", bounce: 0.2, duration: 0.3 };
export const INSTANT: Transition = { duration: 0 };

/** The active-tab pill sliding between tabs. */
export function pillTransition(reduced: boolean | null): Transition {
  return reduced ? INSTANT : SPRING;
}
