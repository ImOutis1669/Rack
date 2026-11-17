import { UnauthorizedError } from '@rack/shared/client';

import { describeError } from './errors';

describe('describeError', () => {
  it('tells offline from an unreachable server', () => {
    expect(describeError(new TypeError('Network request failed'), false).kind).toBe('offline');
    expect(describeError(new TypeError('Network request failed'), true).message).toMatch(/Tailscale/);
    expect(describeError(new TypeError('x'), undefined).kind).toBe('unreachable');
  });
  it('passes the server message through and names logouts', () => {
    expect(describeError(new Error('Bad hunt'), true)).toEqual({ kind: 'server', message: 'Bad hunt' });
    expect(describeError(new UnauthorizedError('x'), true).kind).toBe('signedOut');
  });
});
