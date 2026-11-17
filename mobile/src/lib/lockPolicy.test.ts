import { LOCK_AFTER_MS, lockEnabled, shouldRelock } from './lockPolicy';

describe('Face ID lock policy', () => {
  it('is on by default when the iPhone can lock, and never without Face ID or a passcode', () => {
    expect(lockEnabled(null, true)).toBe(true);
    expect(lockEnabled('off', true)).toBe(false);
    expect(lockEnabled('on', false)).toBe(false);
  });
  it('locks again after a minute in the background, not after a quick switch', () => {
    expect(shouldRelock(null, 10)).toBe(false);
    expect(shouldRelock(0, LOCK_AFTER_MS - 1)).toBe(false);
    expect(shouldRelock(0, LOCK_AFTER_MS)).toBe(true);
  });
});
