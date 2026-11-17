const mockMem = new Map<string, string>();
jest.mock('./storage', () => ({
  kv: { getItem: (k: string) => mockMem.get(k) ?? null, setItem: (k: string, v: string) => void mockMem.set(k, v), removeItem: (k: string) => void mockMem.delete(k) },
}));

import { perfEnabled, perfSnapshot, recordRequest, setPerfEnabled } from './perfStore';

describe('performance readout store', () => {
  it('is off by default and records nothing then', () => {
    expect(perfEnabled()).toBe(false);
    recordRequest('https://rack.ts.net/api/feed?sort=best', 120, 200);
    expect(perfSnapshot().requests).toEqual([]);
  });

  it('records API timings without the host or query string once switched on', () => {
    setPerfEnabled(true);
    expect(mockMem.get('rack.perf')).toBe('on');
    recordRequest('https://rack.ts.net/api/feed?sort=best&cursor=x', 123.6, 200);
    recordRequest('https://rack.ts.net/api/saved', 40, 401);
    expect(perfSnapshot().requests).toEqual([
      { path: '/api/saved', ms: 40, status: 401 },
      { path: '/api/feed', ms: 124, status: 200 },
    ]);
  });
});
