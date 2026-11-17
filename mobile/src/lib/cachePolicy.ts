// Same rules as the web (CLAUDE.md "Instant start", docs/ios-brief.md): anything cached on the
// phone (feed snapshot, photos) is at most 24 hours old and cleared on log out, log out
// everywhere and any 401. The photo cache has no expiry of its own, so it's emptied whole once
// it's 24 hours old (checked at start and whenever the app comes back to the foreground).
import { MAX_AGE_MS } from '@rack/shared/snapshot';

export const IMAGES_CLEARED_KEY = 'rack.images.clearedAt';

/** Should the photo cache be emptied now? An unknown or bad timestamp counts as too old. */
export function imageCacheExpired(clearedAt: string | null, now: number): boolean {
  const at = Number(clearedAt);
  return !clearedAt || !Number.isFinite(at) || at > now || now - at > MAX_AGE_MS;
}
