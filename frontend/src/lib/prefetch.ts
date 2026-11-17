import type { QueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Listing } from "@rack/shared/types";

export const GALLERY_STALE_MS = 10 * 60_000;

/**
 * Prefetch a listing's details when its tile appears? Only where they come from Rack's own
 * database. Vinted details mean fetching the item page from vinted.co.uk, so those wait for a
 * touch (still before the sheet opens) instead of firing for every tile scrolled past.
 */
export function prefetchOnView(source: string): boolean {
  return source !== "vinted";
}

export function prefetchGallery(qc: QueryClient, id: number): void {
  void qc.prefetchQuery({ queryKey: ["gallery", id], queryFn: () => api.gallery(id), staleTime: GALLERY_STALE_MS });
}

/** On touch: the details plus the full-size first photo the sheet will show. */
export function prefetchForOpen(qc: QueryClient, item: Pick<Listing, "id" | "images">, preload: (url: string) => void = preloadImage): void {
  prefetchGallery(qc, item.id);
  if (item.images[0]) preload(item.images[0]);
}

function preloadImage(url: string): void {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
}
