/** Tile photos come from Rack's cached WebP thumbnails, not the full-size marketplace photo. */

/** Rendered tile width: 2 columns on phones, 3 on tablets, about 5 on desktop. */
export const TILE_SIZES = "(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw";

export interface TileImage {
  src: string;
  srcSet?: string;
  sizes?: string;
}

/** `base` is a thumbnail route (`/api/img/12`, `/api/taste/3/thumb`); 480 and 960 px wide. */
export function thumbSet(base: string): TileImage {
  return { src: `${base}?w=480`, srcSet: `${base}?w=480 480w, ${base}?w=960 960w`, sizes: TILE_SIZES };
}

/** A listing tile's first photo as a thumbnail; the original URL if Rack has no id for it. */
export function listingTileImage(item: { images: string[]; image_ids?: number[] }): TileImage | null {
  const id = item.image_ids?.[0];
  if (id != null) return thumbSet(`/api/img/${id}`);
  return item.images[0] ? { src: item.images[0] } : null;
}
