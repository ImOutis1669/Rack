/**
 * Instant start: the last feed (first page, default view) and Saved list are kept in
 * localStorage and shown straight away while fresh results load. Never auth data. Cleared on
 * logout, "log out everywhere" and any "not signed in" response. At most 24 hours old.
 */

const PREFIX = "rack.snap.";
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export type SnapshotKey = "feed" | "saved";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveSnapshot<T>(key: SnapshotKey, data: T, store: Store | null = storage(), now = Date.now()): void {
  try {
    store?.setItem(PREFIX + key, JSON.stringify({ v: 1, at: now, data }));
  } catch {
    // full or blocked storage: instant start just doesn't happen
  }
}

export function loadSnapshot<T>(key: SnapshotKey, store: Store | null = storage(), now = Date.now()): T | undefined {
  try {
    const raw = store?.getItem(PREFIX + key);
    if (!raw) return undefined;
    const snap = JSON.parse(raw) as { v?: number; at?: number; data?: T };
    if (snap.v !== 1 || typeof snap.at !== "number" || now - snap.at > MAX_AGE_MS) {
      store?.removeItem(PREFIX + key);
      return undefined;
    }
    return snap.data;
  } catch {
    return undefined;
  }
}

export function clearSnapshots(store: Store | null = storage()): void {
  for (const key of ["feed", "saved"] as const) {
    try {
      store?.removeItem(PREFIX + key);
    } catch {
      // ignore
    }
  }
}

/** Only the default view of the feed is kept (no filters, "For you"). */
export function isDefaultFeed(p: { sort: string; sources: unknown[]; maxPrice: number | null; category?: unknown; brand?: string }, newOnly: boolean): boolean {
  return p.sort === "best" && p.sources.length === 0 && p.maxPrice == null && !p.category && !p.brand && !newOnly;
}
