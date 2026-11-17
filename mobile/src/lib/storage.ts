// Device storage for cached data (never auth: the token lives in the Keychain, lib/session.ts).
import * as snap from '@rack/shared/snapshot';
import { Image } from 'expo-image';
import Storage from 'expo-sqlite/kv-store';

import { IMAGES_CLEARED_KEY, imageCacheExpired } from './cachePolicy';

/** expo-sqlite's key-value store as the shared snapshot Store. */
export const kv: snap.Store = {
  getItem: (k) => Storage.getItemSync(k),
  setItem: (k, v) => Storage.setItemSync(k, v),
  removeItem: (k) => void Storage.removeItemSync(k),
};

export const saveSnapshot = <T,>(key: snap.SnapshotKey, data: T): void => snap.saveSnapshot(key, data, kv);
export const loadSnapshot = <T,>(key: snap.SnapshotKey): T | undefined => snap.loadSnapshot<T>(key, kv);

async function clearImages(): Promise<void> {
  await Promise.all([Image.clearDiskCache(), Image.clearMemoryCache()]);
  kv.setItem(IMAGES_CLEARED_KEY, String(Date.now()));
}

/** Log out, log out everywhere, any 401: forget the feed snapshot and every cached photo. */
export async function clearDeviceData(): Promise<void> {
  snap.clearSnapshots(kv);
  kv.removeItem('rack.recentSearches'); // search history is the account's too (v2.1)
  await clearImages();
}

/** Empty the photo cache once it's 24 hours old. */
export async function expireImageCache(now = Date.now()): Promise<void> {
  if (imageCacheExpired(kv.getItem(IMAGES_CLEARED_KEY), now)) await clearImages();
}
