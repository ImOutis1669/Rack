/** Tile photos come from Rack's cached thumbnails (AVIF or WebP), not the full-size marketplace photo. */

/** Rendered tile width: 2 columns on phones, 3 on tablets, about 5 on desktop. */
export const TILE_SIZES = "(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw";

/**
 * Bumped with the API's rack.thumbs.SETTINGS_VERSION. Thumbnails are cached by the browser for a
 * week as immutable, so the URL must change whenever the picture would: new settings, or a new
 * photo URL behind the same image id (v1.2: eBay photos moved from s-l225 to s-l1600).
 */
export const THUMB_VERSION = 2;

export interface TileImage {
  src: string;
  srcSet?: string;
  sizes?: string;
}

/** Short, stable FNV-1a hash (base 36) of a photo URL, for the `v` cache key. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * `base` is a thumbnail route (`/api/img/12`, `/api/taste/3/thumb`); 480, 640 and 960 px wide.
 * `key` (the photo URL) makes the cache key change when the photo behind the route changes.
 */
export function thumbSet(base: string, key?: string): TileImage {
  const url = (w: ThumbWidth) => thumbUrl(base, w, key);
  return { src: url(480), srcSet: `${url(480)} 480w, ${url(640)} 640w, ${url(960)} 960w`, sizes: TILE_SIZES };
}

export type ThumbWidth = 480 | 640 | 960;

/** One thumbnail URL at a fixed width (the iOS app picks the width itself). */
export function thumbUrl(base: string, w: ThumbWidth, key?: string): string {
  const v = key ? `${THUMB_VERSION}.${shortHash(key)}` : `${THUMB_VERSION}`;
  return `${base}?w=${w}&v=${v}`;
}

/** Smallest thumbnail at least `px` wide (device pixels), else the largest. */
export function thumbWidthFor(px: number): ThumbWidth {
  return px <= 480 ? 480 : px <= 640 ? 640 : 960;
}

/** A listing's first photo as one thumbnail URL path, or the original URL if Rack has no id. */
export function listingThumb(item: { images: string[]; image_ids?: number[] }, w: ThumbWidth): string | null {
  const id = item.image_ids?.[0];
  if (id != null) return thumbUrl(`/api/img/${id}`, w, item.images[0]);
  return item.images[0] ?? null;
}

/** A listing tile's first photo as a thumbnail; the original URL if Rack has no id for it. */
export function listingTileImage(item: { images: string[]; image_ids?: number[] }): TileImage | null {
  const id = item.image_ids?.[0];
  if (id != null) return thumbSet(`/api/img/${id}`, item.images[0]);
  return item.images[0] ? { src: item.images[0] } : null;
}
