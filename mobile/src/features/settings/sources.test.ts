import type { SourceHealth } from '@rack/shared/types';

import { light } from '@/theme/colors';

import { overallColor, statusColor } from './sources';

const h = (status: SourceHealth['status'], usage_warning = false) => ({ status, usage_warning }) as SourceHealth;

describe('source status colours (the web Sources sheet)', () => {
  it('per source', () => {
    expect(statusColor(h('ok'), light)).toBe(light.accent);
    expect(statusColor(h('ok', true), light)).toBe(light.warning); // near eBay's daily limit
    expect(statusColor(h('degraded'), light)).toBe(light.warning);
    expect(statusColor(h('blocked'), light)).toBe(light.danger);
    expect(statusColor(h('never_run'), light)).toBe(light.subtle);
  });
  it('overall: any trouble wins, then any working', () => {
    expect(overallColor([h('ok'), h('down')], light)).toBe(light.warning);
    expect(overallColor([h('ok'), h('not_configured')], light)).toBe(light.accent);
    expect(overallColor([], light)).toBe(light.subtle);
  });
});
