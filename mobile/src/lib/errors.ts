import { UnauthorizedError } from '@rack/shared/client';

export type Problem = { kind: 'offline' | 'unreachable' | 'signedOut' | 'server'; message: string };

/**
 * What went wrong, in plain words. A failed fetch (TypeError) means no network, or the phone
 * can't reach the server: on this setup that's almost always Tailscale being off.
 */
export function describeError(err: unknown, online: boolean | undefined): Problem {
  if (err instanceof UnauthorizedError) return { kind: 'signedOut', message: 'Logged out. Log in again to continue.' };
  if (err instanceof TypeError) {
    return online === false
      ? { kind: 'offline', message: "You're offline." }
      : { kind: 'unreachable', message: "Can't reach Rack. Check that Tailscale is on." };
  }
  const msg = err instanceof Error && err.message ? err.message : 'Something went wrong';
  return { kind: 'server', message: msg };
}
