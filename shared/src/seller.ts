import type { Listing } from "./types";

/** Sources whose seller data Rack never stores (eBay: "I do not persist eBay data"). */
export const NO_SELLER_DATA_SOURCES = new Set(["ebay"]);

export const NO_SELLER_REASON = "eBay seller names aren't stored";

export type SellerHide =
  | { available: true; name: string }
  | { available: false; reason: string }
  | null;

/** What the "Hide seller" menu entry should offer for a listing (null: show nothing). */
export function sellerHide(item: Pick<Listing, "source" | "seller">): SellerHide {
  if (NO_SELLER_DATA_SOURCES.has(item.source)) return { available: false, reason: NO_SELLER_REASON };
  return item.seller?.name ? { available: true, name: item.seller.name } : null;
}
