export type Source = "ebay" | "vinted" | "grailed" | "vestiaire";

export interface Seller {
  name: string | null;
  rating: number | null;
  count: number | null;
}

export interface BuyLink {
  source: Source;
  url: string;
  price_gbp: string | null;
}

export interface Listing {
  id: number;
  source: Source;
  source_id: string;
  url: string;
  title: string;
  brand: string | null;
  price: string;
  currency: string;
  price_gbp: string | null;
  shipping_cost_gbp: string | null;
  size: string | null;
  condition: string | null;
  images: string[];
  seller: Seller | null;
  listed_at: string | null;
  first_seen_at: string;
  country: string | null;
  score: number | null;
  why: string | null;
  buy_links: BuyLink[];
}

export interface FeedPage {
  items: Listing[];
  next_cursor: string | null;
}

export type Sort = "newest" | "price_asc" | "price_desc";

export interface FeedParams {
  sort: Sort;
  sources: Source[];
  maxPrice: number | null;
}

export interface SourceHealth {
  source: Source;
  configured: boolean;
  last_success_at: string | null;
  last_error: string | null;
  error_count: number;
  status: "ok" | "degraded" | "down" | "not_configured" | "never_run";
}
