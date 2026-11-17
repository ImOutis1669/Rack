// Pure helpers for the Settings pages: the same rules as the web's Settings form
// (frontend/src/pages/Settings.tsx), split per page.
import { formatLength, parseLengthCm, splitList } from '@rack/shared/units';
import { CATEGORIES, type Category, type Designer, type Measurements, type Profile } from '@rack/shared/types';

export type LenKey = Exclude<keyof Measurements, 'tolerance_cm'>;
export const LENGTHS: [LenKey, string][] = [
  ['inseam_min_cm', 'Minimum inseam'],
  ['sleeve_min_cm', 'Minimum sleeve'],
  ['length_min_cm', 'Minimum top length'],
  ['p2p_min_cm', 'Minimum pit to pit'],
  ['p2p_max_cm', 'Maximum pit to pit'],
];
export const CAT_LABEL: Record<Category, string> = {
  any: 'All',
  tops: 'Tops',
  trousers: 'Trousers',
  shoes: 'Shoes',
  outerwear: 'Outerwear',
  accessories: 'Accessories',
};
export const SIZE_PLACEHOLDER: Partial<Record<Category, string>> = { trousers: '32, 33', shoes: 'UK 11, 46' };

/** Length fields as text in a unit. */
export function lengthTexts(m: Measurements, unit: 'cm' | 'in'): Record<LenKey, string> {
  return Object.fromEntries(LENGTHS.map(([k]) => [k, formatLength(m[k], unit)])) as Record<LenKey, string>;
}

/**
 * Measurements to save. Only fields you edited are parsed (in the unit shown); the rest keep
 * their exact stored cm, so switching units never drifts a value (the web's rule).
 */
export function measurementsFrom(
  stored: Measurements,
  texts: Record<LenKey, string>,
  edited: ReadonlySet<LenKey>,
  unit: 'cm' | 'in',
  tolerance: number,
): Measurements {
  const out: Measurements = { ...stored, tolerance_cm: tolerance };
  for (const [k] of LENGTHS) out[k] = edited.has(k) ? parseLengthCm(texts[k], unit) : stored[k];
  return out;
}

/** Sizes per category as "L, XL" text, and back (empty categories dropped). */
export function sizeTexts(p: Profile): Record<string, string> {
  return Object.fromEntries(CATEGORIES.map((c) => [c, (p.sizes[c] ?? []).join(', ')]));
}
export function sizesFrom(texts: Record<string, string>): Profile['sizes'] {
  return Object.fromEntries(CATEGORIES.map((c) => [c, splitList(texts[c] ?? '')]).filter(([, v]) => v.length));
}

/** "250" -> 250, "" -> null, junk -> null. */
export function poundsOrNull(s: string): number | null {
  const t = s.replace(/[£,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Budget from the page's text fields. */
export function budgetFrom(defaultText: string, perCategory: Record<string, string>): Profile['budget'] {
  const per: Partial<Record<Category, number>> = {};
  for (const c of CATEGORIES) {
    const n = poundsOrNull(perCategory[c] ?? '');
    if (n != null) per[c] = n;
  }
  return { default_max_gbp: poundsOrNull(defaultText), per_category: per };
}

/** Designers to save (blank names dropped) and the similar-designer lists for them. */
export function designersToSave(
  designers: Designer[],
  adjacentTexts: Record<string, string>,
  serverAdjacent: Record<string, string[]>,
): { designers: Designer[]; adjacent: Record<string, string[]> } {
  const clean = designers.map((d) => ({ ...d, name: d.name.trim() })).filter((d) => d.name);
  // the server seeds suggestions for new loved/liked designers when they're saved; keep those,
  // and your edits win for designers you still have
  const adjacent: Record<string, string[]> = { ...serverAdjacent };
  for (const [k, v] of Object.entries(adjacentTexts)) if (clean.some((d) => d.name === k)) adjacent[k] = splitList(v);
  return { designers: clean, adjacent };
}
