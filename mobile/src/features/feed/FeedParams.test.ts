import { DEFAULT_PARAMS, filterCount } from './FeedParams';

describe('filterCount (the Filters badge)', () => {
  it('counts sources, brand, max price and new-only, not sort or category', () => {
    expect(filterCount(DEFAULT_PARAMS, false)).toBe(0);
    expect(filterCount({ ...DEFAULT_PARAMS, sort: 'newest', category: 'shoes' }, false)).toBe(0);
    expect(filterCount({ ...DEFAULT_PARAMS, sources: ['ebay', 'vinted'], brand: ' rick ', maxPrice: 200 }, true)).toBe(5);
    expect(filterCount({ ...DEFAULT_PARAMS, brand: '   ' }, false)).toBe(0);
  });
});
