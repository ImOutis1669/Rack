jest.mock('@/lib/auth', () => ({}));
jest.mock('@/components/Toast', () => ({}));

import { huntStatus } from './useHuntActions';

describe('huntStatus', () => {
  const ago = (iso: string) => `at ${iso}`;
  it('says running, last checked, or not run yet', () => {
    expect(huntStatus({ run_requested_at: '2026-11-17T10:00:00Z', last_run_at: null }, ago)).toBe('Running now');
    expect(huntStatus({ run_requested_at: null, last_run_at: 'x' }, ago)).toBe('Checked at x');
    expect(huntStatus({ run_requested_at: null, last_run_at: null }, ago)).toBe('Not run yet');
  });
});
