import type { Category, Sort, Source } from '@rack/shared/types';

// Same labels and order as the web feed (frontend/src/pages/Feed.tsx).
export const SOURCES: Source[] = ['ebay', 'vinted', 'grailed'];
export const SORTS: [Sort, string][] = [
  ['best', 'For you'],
  ['newest', 'Newest'],
  ['price_asc', 'Price: low to high'],
  ['price_desc', 'Price: high to low'],
];
export const CATEGORY_LABEL: Record<Category, string> = {
  any: 'All',
  tops: 'Tops',
  trousers: 'Trousers',
  shoes: 'Shoes',
  outerwear: 'Outerwear',
  accessories: 'Accessories',
};
/** Brand colour of each marketplace's dot (frontend/src/index.css --color-*). */
export const SOURCE_DOT: Record<Source, { light: string; dark: string }> = {
  ebay: { light: '#E53238', dark: '#E53238' },
  vinted: { light: '#09B1BA', dark: '#09B1BA' },
  grailed: { light: '#111113', dark: '#FFFFFF' },
};
