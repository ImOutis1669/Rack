// Web side of the instant-start snapshots (rules in @rack/shared/snapshot): kept in localStorage.
import * as snap from "@rack/shared/snapshot";

export { isDefaultFeed, MAX_AGE_MS, type SnapshotKey } from "@rack/shared/snapshot";

function storage(): snap.Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export const saveSnapshot = <T,>(key: snap.SnapshotKey, data: T): void => snap.saveSnapshot(key, data, storage());
export const loadSnapshot = <T,>(key: snap.SnapshotKey): T | undefined => snap.loadSnapshot<T>(key, storage());
export const clearSnapshots = (): void => snap.clearSnapshots(storage());
