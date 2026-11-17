import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

// iOS Settings > Accessibility > Motion > Reduce Motion: no fades, zooms or springs.
// One subscription for the whole app (every grid tile reads it).
let reduce = false;
let started = false;
const listeners = new Set<() => void>();

function set(on: boolean) {
  reduce = on;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  if (!started) {
    started = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(set);
    AccessibilityInfo.addEventListener('reduceMotionChanged', set);
  }
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, () => reduce);
}
