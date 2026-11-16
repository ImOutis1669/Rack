import { Bookmark, PackageCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Listing } from "../api/types";
import { formatGBP } from "../lib/format";
import { landedLabel, previousPrice } from "../lib/landed";
import { listingTileImage } from "../lib/thumbs";
import { BlurFade } from "./magicui/blur-fade";
import { SourceBadge } from "./SourceBadge";
import { IconButton } from "./ui";
import type { ListingActions } from "./useListingActions";
import { VoteButtons } from "./VoteButtons";

/** Photo-first tile: the clothes are the interface. Everything else lives in the detail sheet. */
export function ListingTile({
  item,
  actions,
  index,
  onOpen,
  onSeen,
  onBought,
}: {
  item: Listing;
  actions: ListingActions;
  index: number;
  onOpen: () => void;
  onSeen?: (id: number) => void;
  /** Saved page: show an "I bought it" capsule under the price. */
  onBought?: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const was = previousPrice(item);
  const landed = landedLabel(item.landed);
  const copies = item.buy_links.length;
  const photo = listingTileImage(item);
  const meta = [item.size && `Size ${item.size}`, landed, copies > 1 && `${copies} listings`].filter(Boolean).join(" · ");

  useEffect(() => {
    const el = ref.current;
    if (!el || !onSeen) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) timer = setTimeout(() => onSeen(item.id), 1200);
        else if (timer) clearTimeout(timer);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [item.id, onSeen]);

  const tile = (
    <article ref={ref} className="group">
      <div className="relative overflow-hidden rounded-photo bg-fill">
        <button onClick={onOpen} aria-label={`Open ${item.title}`} className="press block w-full">
          {photo ? (
            <img
              src={photo.src}
              srcSet={photo.srcSet}
              sizes={photo.sizes}
              alt=""
              decoding="async"
              loading={index < 8 ? "eager" : "lazy"}
              referrerPolicy="no-referrer"
              className="aspect-[4/5] w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="aspect-[4/5] w-full" />
          )}
        </button>
        <SourceBadge source={item.source} glass className="pointer-events-none absolute top-2 left-2" />
        <IconButton
          label={actions.saved ? "Remove from saved" : "Save"}
          glass
          active={actions.saved}
          onClick={actions.toggleSave}
          className="absolute top-1 right-1 size-9"
        >
          <Bookmark size={17} strokeWidth={2} fill={actions.saved ? "currentColor" : "none"} />
        </IconButton>
        {was != null && (
          <span className="glass pointer-events-none absolute bottom-2 left-2 rounded-full px-2 py-0.5 text-caption font-semibold text-accent">
            Price cut
          </span>
        )}
        {/* quick feedback on desktop hover; on iPhone it's in the detail sheet */}
        <div className="absolute right-1.5 bottom-1.5 hidden opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 md:flex">
          <VoteButtons compact vote={actions.vote} onVote={actions.castVote} />
        </div>
      </div>
      <button onClick={onOpen} className="block w-full pt-2 text-left">
        {item.brand && <p className="truncate text-caption font-semibold tracking-wide text-muted uppercase">{item.brand}</p>}
        <h3 className="truncate text-footnote">{item.title}</h3>
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
          <span className="tabular text-headline font-semibold">{formatGBP(item.price_gbp)}</span>
          {was != null && <span className="tabular text-caption text-muted line-through">{formatGBP(was)}</span>}
        </p>
        {meta && <p className="truncate text-caption text-muted">{meta}</p>}
      </button>
      {onBought && (
        <button
          type="button"
          onClick={onBought}
          className="press mt-1.5 inline-flex h-11 items-center gap-1.5 rounded-full bg-fill px-3.5 text-footnote font-semibold"
        >
          <PackageCheck size={15} strokeWidth={2} />
          I bought it
        </button>
      )}
    </article>
  );

  // Entrance animation on the first screenful only, so recycled scrolling never replays it.
  return index < 12 ? (
    <BlurFade delay={Math.min(index, 11) * 0.03} className="mb-5 break-inside-avoid">
      {tile}
    </BlurFade>
  ) : (
    <div className="mb-5 break-inside-avoid">{tile}</div>
  );
}
