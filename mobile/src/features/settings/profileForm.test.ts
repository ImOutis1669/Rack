import type { Measurements, Profile } from '@rack/shared/types';

import { budgetFrom, designersToSave, lengthTexts, measurementsFrom, poundsOrNull, sizesFrom, sizeTexts } from './profileForm';

const stored: Measurements = {
  inseam_min_cm: 81.3,
  sleeve_min_cm: null,
  p2p_min_cm: 56,
  p2p_max_cm: null,
  length_min_cm: null,
  length_max_cm: null,
  tolerance_cm: 2,
};

describe('fit', () => {
  it('keeps untouched lengths exact when the unit changes', () => {
    const inches = lengthTexts(stored, 'in');
    const m = measurementsFrom(stored, inches, new Set(), 'in', 2);
    expect(m.inseam_min_cm).toBe(81.3);
    expect(m.p2p_min_cm).toBe(56);
  });
  it('parses edited fields in the unit shown, and clears empty ones', () => {
    const texts = { ...lengthTexts(stored, 'in'), inseam_min_cm: '32', p2p_min_cm: '' };
    const m = measurementsFrom(stored, texts, new Set(['inseam_min_cm', 'p2p_min_cm'] as const), 'in', 1.5);
    expect(m.inseam_min_cm).toBeCloseTo(81.28, 1);
    expect(m.p2p_min_cm).toBeNull();
    expect(m.tolerance_cm).toBe(1.5);
  });
});

describe('sizes and budget', () => {
  it('round-trips sizes and drops empty categories', () => {
    const p = { sizes: { tops: ['L', 'XL'], shoes: [] } } as unknown as Profile;
    expect(sizeTexts(p).tops).toBe('L, XL');
    expect(sizesFrom({ tops: 'L, XL', shoes: '  ', trousers: '32,33' })).toEqual({ tops: ['L', 'XL'], trousers: ['32', '33'] });
  });
  it('reads pounds and builds the budget', () => {
    expect(poundsOrNull('£1,200')).toBe(1200);
    expect(poundsOrNull('')).toBeNull();
    expect(poundsOrNull('abc')).toBeNull();
    expect(budgetFrom('400', { shoes: '600', tops: '' })).toEqual({ default_max_gbp: 400, per_category: { shoes: 600 } });
  });
});

describe('designers', () => {
  it('drops blank names, keeps server suggestions, and your edits win', () => {
    const out = designersToSave(
      [{ name: ' Rick Owens ', weight: 'love' }, { name: '', weight: 'like' }, { name: 'Guidi', weight: 'like' }],
      { 'Rick Owens': 'Boris Bidjan Saberi, Carol Christian Poell', Removed: 'x' },
      { 'Rick Owens': ['Ann Demeulemeester'], Guidi: ['Carpe Diem'] },
    );
    expect(out.designers).toEqual([{ name: 'Rick Owens', weight: 'love' }, { name: 'Guidi', weight: 'like' }]);
    expect(out.adjacent['Rick Owens']).toEqual(['Boris Bidjan Saberi', 'Carol Christian Poell']);
    expect(out.adjacent.Guidi).toEqual(['Carpe Diem']);
    expect(out.adjacent).not.toHaveProperty('Removed');
  });
});
