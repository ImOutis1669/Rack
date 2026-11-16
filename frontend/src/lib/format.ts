const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

export function formatGBP(value: string | number | null | undefined): string {
  if (value == null || value === "") return "–";
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? gbp.format(n) : "–";
}

export function timeAgo(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function sellerLabel(rating: number | null, count: number | null): string | null {
  if (rating == null && count == null) return null;
  const parts: string[] = [];
  if (rating != null) parts.push(`${rating.toFixed(rating >= 99.95 ? 0 : 1)}%`);
  if (count != null) parts.push(`(${count})`);
  return parts.join(" ");
}

export const SOURCE_LABEL: Record<string, string> = {
  ebay: "eBay",
  vinted: "Vinted",
  grailed: "Grailed",
  vestiaire: "Vestiaire",
};
