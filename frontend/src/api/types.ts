export type Source = "ebay" | "vinted" | "grailed" | "vestiaire";
export type Category = "any" | "tops" | "trousers" | "shoes" | "outerwear" | "accessories";
export const CATEGORIES: Exclude<Category, "any">[] = ["tops", "trousers", "shoes", "outerwear", "accessories"];

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
  image_ids?: number[]; // same order as images: /api/img/{id}?w=480|960 thumbnails
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
  was_price_gbp: string | null;
  landed: Landed | null;
  buy_links: BuyLink[];
}

export interface Landed {
  total_gbp: string;
  shipping_gbp: string | null;
  vat_gbp: string;
  duty_gbp: string;
  fee_gbp: string;
  imported: boolean;
  notes: string[];
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
  usage?: string | null;
  usage_warning?: boolean;
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
  name?: string | null;
  purchase_date?: string | null; // YYYY-MM-DD
  category?: Exclude<Category, "any"> | null; // set by you
  effective_category?: Category; // yours, else worked out from the name
  image: string | null;
  thumb?: string | null; // /api/taste/{id}/thumb (add ?w=480|960)
  image_url: string | null;
  embedded: boolean;
  embed_error: string | null;
  created_at: string;
  // "I bought it" details (null for items added by hand)
  listing_id?: number | null;
  source?: Source | null;
  listing_url?: string | null;
  brand?: string | null;
  size?: string | null;
  purchase_price_gbp?: string | null;
  purchased_at?: string | null;
  photo_missing?: boolean;
  custom_value_gbp?: string | null;
  estimate_gbp?: string | null; // median asking price of similar listings (null: no estimate)
  estimate_count?: number | null; // similar listings found (null: not estimated)
  estimate_at?: string | null;
  estimate_brand?: string | null;
  estimate_kind?: "sold" | "asking" | null;
  trend?: Trend | null;
}

export interface TrendWindow {
  pct: number;
  direction: "up" | "down" | "steady";
  recent_median: string;
  prior_median: string;
  recent_sales: number;
  prior_sales: number;
}

export interface TrendPoint {
  end: string; // ISO date the 30-day bucket ends
  median: string | null; // null: too few sales that month
  sales: number;
}

export interface Trend {
  "30": TrendWindow | null;
  "90": TrendWindow | null;
  points: TrendPoint[];
  sales: number;
}

export interface Comparable {
  id: number;
  title: string;
  source: Source;
  url: string;
  price_gbp: string | null;
  image: string | null;
  similarity: number;
  sold_at?: string | null;
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

export interface RefreshStatus {
  running: boolean;
  queued: boolean;
  last_at: string | null;
  next_allowed_at: string | null;
  results: Record<string, number>;
  message: string;
}

export type FreeSource = "ebay" | "vinted" | "grailed";

export interface HuntInput {
  name: string;
  query: string;
  category: Category;
  max_price_gbp: number | null;
  sizes: string[];
  strict_size: boolean; // "Size must match"
  sources: FreeSource[];
  min_score: number | null;
  interval_minutes: number;
  enabled: boolean;
  notify: boolean;
}

export interface Hunt extends HuntInput {
  id: number;
  last_run_at: string | null;
  run_requested_at: string | null;
  last_error: string | null;
  match_count: number;
  new_count: number;
}

export interface ChannelStatus {
  name: string;
  configured: boolean;
  detail: string;
}

export interface SentNotification {
  kind: string;
  title: string;
  body: string;
  url: string | null;
  channels: Record<string, string>;
  sent_at: string;
}

export interface Visit {
  visit_start: string;
  last_visit: string | null;
}
