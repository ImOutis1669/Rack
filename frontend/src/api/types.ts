export type Source = "ebay" | "vinted" | "grailed" | "vestiaire";
export type Category = "any" | "tops" | "trousers" | "shoes" | "outerwear";
export const CATEGORIES: Category[] = ["tops", "trousers", "shoes", "outerwear"];

export interface Seller {
  name: string | null;
  rating: number | null;
  count: number | null;
}

export interface BuyLink {
  source: Source;
  url: string;
  price_gbp: string | null;
  size: string | null;
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
  category: Category | null;
  measurements: Partial<Record<"p2p_cm" | "inseam_cm" | "sleeve_cm" | "length_cm" | "waist_in", number>>;
  feedback: -1 | 1 | null;
  saved: boolean;
  price_gbp_at_save: string | null;
  buy_links: BuyLink[];
}

export interface FeedPage {
  items: Listing[];
  next_cursor: string | null;
}

export type Sort = "best" | "newest" | "price_asc" | "price_desc";

export interface FeedParams {
  sort: Sort;
  sources: Source[];
  maxPrice: number | null;
  category?: Category | null;
  brand?: string;
  newSince?: string | null;
  hideSeenBefore?: string | null;
}

export interface SourceHealth {
  source: Source;
  configured: boolean;
  last_success_at: string | null;
  last_error: string | null;
  error_count: number;
  consecutive_errors: number;
  last_result_count: number | null;
  last_check_at: string | null;
  blocked: boolean;
  status: "ok" | "degraded" | "down" | "blocked" | "not_configured" | "never_run";
}

export type DesignerWeight = "love" | "like" | "curious" | "exclude";

export interface Designer {
  name: string;
  weight: DesignerWeight;
}

export interface Measurements {
  inseam_min_cm: number | null;
  sleeve_min_cm: number | null;
  p2p_min_cm: number | null;
  p2p_max_cm: number | null;
  length_min_cm: number | null;
  tolerance_cm: number;
}

export interface Weights {
  visual: number;
  text: number;
  brand: number;
  feedback: number;
  deal: number;
  fit: number;
  knockoff_penalty: number;
}

export interface Profile {
  context: string;
  banned_keywords: string[];
  sizes: Partial<Record<Category, string[]>>;
  strict_size: boolean;
  measurements: Measurements;
  budget: { default_max_gbp: number | null; per_category: Partial<Record<Category, number>> };
  weights: Weights;
  exploration: number;
  categories: Category[];
}

export interface ProfileResponse {
  profile: Profile;
  version: number;
  designer_count: number;
  taste_count: number;
}

export type TasteKind = "wardrobe" | "wishlist";

export interface TasteItem {
  id: number;
  kind: TasteKind;
  text: string | null;
  note: string | null;
  image: string | null;
  image_url: string | null;
  embedded: boolean;
  embed_error: string | null;
  created_at: string;
}

export interface Hidden {
  id: number;
  kind: "seller" | "brand";
  value: string;
}

export interface GalleryInfo {
  images: string[];
  description: string | null;
  photo_count: number | null;
  note: string | null;
}

export interface Visit {
  visit_start: string;
  last_visit: string | null;
}
