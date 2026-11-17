// When the Face ID lock (iOS step 8) asks to unlock. Pure, so it's tested without a device.

/** Coming back after this long in the background locks the app again. */
export const LOCK_AFTER_MS = 60_000;
export const LOCK_KEY = 'rack.lock';

/** The stored switch: on unless turned off (default on when the device can lock). */
export function lockEnabled(stored: string | null, deviceCanLock: boolean): boolean {
  if (!deviceCanLock) return false;
  return stored !== 'off';
}

/** Lock again after returning to the foreground? */
export function shouldRelock(backgroundedAt: number | null, now: number): boolean {
  return backgroundedAt != null && now - backgroundedAt >= LOCK_AFTER_MS;
}
