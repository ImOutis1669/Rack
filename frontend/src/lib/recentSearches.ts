// Recent searches (v2.1), kept in this browser only and cleared when the account signs out, so
// the next person on the same browser never sees them (audit 2026-11-17, RACK-23).
const KEY = "rack.recentSearches";

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadRecent(): string[] {
  try {
    const v: unknown = JSON.parse(storage()?.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function saveRecent(list: string[]): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(list));
  } catch {
    // private mode: no recent searches
  }
}

export function clearRecent(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // nothing stored
  }
}
