// What you've done to a listing in this session (save, vote, hide), shared by every place that
// shows it: the feed tile and the listing sheet are separate screens in the app, while the web
// shared one state object between them. Values from the server are the default; changes here
// win until the app logs out (cleared with everything else on the device).
import type { Vote } from '@rack/shared/vote';
import { useSyncExternalStore } from 'react';

export interface ListingOverride {
  saved?: boolean;
  vote?: Vote;
  hidden?: boolean;
}

const overrides = new Map<number, ListingOverride>();
const listeners = new Set<() => void>();
const NONE: ListingOverride = Object.freeze({});
let hiddenIds: ReadonlySet<number> = new Set();

// Every change stores a new object (and a new hidden set), so React sees the change through
// useSyncExternalStore's snapshot. Reading the Map directly inside a component made the React
// Compiler keep the first value: the listing sheet only updated after reopening (iOS step 5).
function emit() {
  hiddenIds = new Set([...overrides].filter(([, o]) => o.hidden).map(([id]) => id));
  listeners.forEach((fn) => fn());
}

export function setListingState(id: number, patch: ListingOverride): void {
  overrides.set(id, { ...overrides.get(id), ...patch });
  emit();
}

export function getListingState(id: number): ListingOverride | undefined {
  return overrides.get(id);
}

export function clearListingState(): void {
  overrides.clear();
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Merge what the server said with what you changed in this session. */
export function mergeListingState(
  item: { saved: boolean; feedback: Vote },
  o: ListingOverride,
): { saved: boolean; vote: Vote } {
  return { saved: o.saved ?? item.saved, vote: o.vote !== undefined ? o.vote : item.feedback };
}

/** The listing's saved/vote state: what you changed in this session, else what the server said. */
export function useListingState(item: { id: number; saved: boolean; feedback: Vote }): { saved: boolean; vote: Vote } {
  const o = useSyncExternalStore(subscribe, () => overrides.get(item.id) ?? NONE);
  return mergeListingState(item, o);
}

/** Ids hidden in this session (hide seller / brand, bought): lists drop them without a reload. */
export function useHiddenIds(): ReadonlySet<number> {
  return useSyncExternalStore(subscribe, () => hiddenIds);
}
