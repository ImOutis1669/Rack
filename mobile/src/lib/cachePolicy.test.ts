import { MAX_AGE_MS } from '@rack/shared/snapshot';

import { imageCacheExpired } from './cachePolicy';

describe('photo cache expiry (24 h, like the feed snapshot)', () => {
  const now = 1_000_000_000_000;
  it('keeps a cache emptied less than 24 h ago', () => {
    expect(imageCacheExpired(String(now - 60_000), now)).toBe(false);
    expect(imageCacheExpired(String(now - MAX_AGE_MS), now)).toBe(false);
  });
  it('empties it once older, or when the time is unknown or in the future', () => {
    expect(imageCacheExpired(String(now - MAX_AGE_MS - 1), now)).toBe(true);
    expect(imageCacheExpired(null, now)).toBe(true);
    expect(imageCacheExpired('garbage', now)).toBe(true);
    expect(imageCacheExpired(String(now + 3_600_000), now)).toBe(true); // clock moved back
  });
});
