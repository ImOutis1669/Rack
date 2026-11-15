import type { Listing } from "../api/types";
import { formatGBP, sellerLabel, SOURCE_LABEL, timeAgo } from "../lib/format";
import { Carousel } from "./Carousel";
import { SourceBadge } from "./SourceBadge";

export function ListingCard({ item }: { item: Listing }) {
  const seller = sellerLabel(item.seller?.rating ?? null, item.seller?.count ?? null);
  return (
    <article className="mb-3 break-inside-avoid overflow-hidden rounded-lg bg-neutral-900 ring-1 ring-white/5">
      <Carousel images={item.images} alt={item.title} />
      <div className="space-y-1.5 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <SourceBadge source={item.source} />
          <span className="text-[11px] text-neutral-400">{timeAgo(item.listed_at ?? item.first_seen_at)}</span>
        </div>
        <h3 className="line-clamp-2 text-sm leading-snug">{item.title}</h3>
        <div className="flex items-baseline justify-between">
          <span className="text-base font-semibold">{formatGBP(item.price_gbp)}</span>
          {item.score != null && (
            <span className="text-xs text-emerald-400">{Math.round(item.score * 100)}% match</span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-2 text-[11px] text-neutral-400">
          {item.size && <span>Size {item.size}</span>}
          {item.condition && <span>{item.condition}</span>}
          {item.shipping_cost_gbp && <span>+{formatGBP(item.shipping_cost_gbp)} post</span>}
          {seller && <span>★ {seller}</span>}
        </div>
        {item.why && <p className="text-[11px] italic text-neutral-300">{item.why}</p>}
        <div className="flex gap-1.5 pt-1">
          {item.buy_links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 rounded bg-white py-1.5 text-center text-xs font-semibold text-black active:bg-neutral-300"
            >
              Buy{item.buy_links.length > 1 ? ` · ${SOURCE_LABEL[link.source]}` : ""}
            </a>
          ))}
        </div>
      </div>
    </article>
  );
}
