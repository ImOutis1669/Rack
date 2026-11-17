// The developer performance readout (the web's ?perf=1, iOS step 8). Off unless switched on in
// Settings > Developer. Nothing leaves the phone; numbers live in memory only.
import { useSyncExternalStore } from 'react';

import { kv } from './storage';

export const PERF_KEY = 'rack.perf';
const MAX = 20;

interface PerfState {
  enabled: boolean;
  /** Recent API calls: path (no query string) and milliseconds. */
  requests: { path: string; ms: number; status: number }[];
  /** App start to the first feed page on screen. */
  firstFeedMs: number | null;
}

const startedAt = Date.now();
let state: PerfState = { enabled: false, requests: [], firstFeedMs: null };
let loaded = false;
const listeners = new Set<() => void>();

function emit(next: PerfState) {
  state = next;
  listeners.forEach((fn) => fn());
}

function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    state = { ...state, enabled: kv.getItem(PERF_KEY) === 'on' };
  } catch {
    // storage unavailable: the readout stays off
  }
}

export function perfEnabled(): boolean {
  ensureLoaded();
  return state.enabled;
}

export function setPerfEnabled(on: boolean): void {
  ensureLoaded();
  kv.setItem(PERF_KEY, on ? 'on' : 'off');
  emit({ ...state, enabled: on });
}

/** Called by the session's fetch wrapper for every API call, when the readout is on. */
export function recordRequest(url: string, ms: number, status: number): void {
  if (!perfEnabled()) return;
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0] ?? url;
  emit({ ...state, requests: [{ path, ms: Math.round(ms), status }, ...state.requests].slice(0, MAX) });
}

export function recordFirstFeed(): void {
  if (state.firstFeedMs != null) return;
  emit({ ...state, firstFeedMs: Date.now() - startedAt });
}

/** Current numbers (tests, debugging). */
export function perfSnapshot(): PerfState {
  return state;
}

export function usePerf(): PerfState {
  ensureLoaded();
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
  );
}
