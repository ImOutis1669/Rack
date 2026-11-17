import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Listing } from "@rack/shared/types";
import { formatGBP, sellerLabel, SOURCE_LABEL, timeAgo } from "@rack/shared/format";
import { huntFromListing } from "@rack/shared/hunts";
import { landedLines, previousPrice } from "@rack/shared/landed";
import { GALLERY_STALE_MS } from "../lib/prefetch";
import { safeHref } from "@rack/shared/safe";
import { sellerHide } from "@rack/shared/seller";
import { cn } from "../lib/utils";
import { AnimatedCircularProgressBar } from "./magicui/animated-circular-progress-bar";
import { ShareButton } from "./ShareButton";
import { SourceBadge } from "./SourceBadge";
import { Button, IconButton, Menu, Sheet } from "./ui";
import type { ListingActions } from "./useListingActions";
import { VoteButtons } from "./VoteButtons";
import { Icon } from "./icons/Icon";

const MEAS: [keyof Listing["measurements"], string][] = [
  ["inseam_cm", "Inseam"],
  ["sleeve_cm", "Sleeve"],
  ["p2p_cm", "Pit to pit"],
  ["length_cm", "Length"],
];

function Photos({ images, title, loading }: { images: string[]; title: string; loading: boolean }) {
  const [index, setIndex] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const target = useRef<number | null>(null);

  const goTo = useCallback(
    (i: number) => {
      const el = strip.current;
      if (!el || images.length === 0) return;
      const next = Math.max(0, Math.min(images.length - 1, i));
      target.current = next;
      setIndex(next);
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    },
    [images.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goTo(index + 1);
      if (e.key === "ArrowLeft") goTo(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, index]);

  const onScroll = () => {
    const el = strip.current;
    if (!el) return;
    const at = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (target.current !== null) {
      if (at === target.current) target.current = null;
      return;
    }
    setIndex(at);
  };

  return (
    <div className="relative bg-fill md:h-full">
      <div
        ref={strip}
        onScroll={onScroll}
        className="no-scrollbar flex aspect-[4/5] snap-x snap-mandatory overflow-x-auto md:aspect-auto md:h-full"
      >
        {images.map((src, i) => (
          <img
            key={src}
            src={src}
            alt={`${title}, photo ${i + 1}`}
            loading={Math.abs(i - index) <= 1 ? "eager" : "lazy"}
            referrerPolicy="no-referrer"
            className="h-full w-full shrink-0 snap-center object-contain"
          />
        ))}
      </div>
      {images.length > 1 && (
        <>
          <div className="glass absolute top-3 right-3 rounded-full px-2.5 py-1 text-caption font-semibold tabular">
            {index + 1} / {images.length}
          </div>
          <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
            {images.map((src, i) => (
              <button
                key={src}
                aria-label={`Photo ${i + 1}`}
                onClick={() => goTo(i)}
                className={cn("h-1.5 rounded-full transition-all", i === index ? "w-4 bg-foreground" : "w-1.5 bg-foreground/35")}
              />
            ))}
          </div>
          <IconButton label="Previous photo" glass onClick={() => goTo(index - 1)} disabled={index === 0} className="absolute top-1/2 left-3 hidden -translate-y-1/2 md:inline-flex">
            <Icon name="chevron-left" size={20} />
          </IconButton>
          <IconButton label="Next photo" glass onClick={() => goTo(index + 1)} disabled={index === images.length - 1} className="absolute top-1/2 right-3 hidden -translate-y-1/2 md:inline-flex">
            <Icon name="chevron-right" size={20} />
          </IconButton>
        </>
      )}
      {loading && <div className="glass absolute top-3 left-3 rounded-full px-2.5 py-1 text-caption text-muted">Loading photos</div>}
    </div>
  );
}

export function ListingSheet({
  item,
  open,
  onClose,
  actions,
  onBought,
}: {
  item: Listing;
  open: boolean;
  onClose: () => void;
  actions: ListingActions;
  /** Offered in the ⋯ menu while the listing is saved. */
  onBought?: () => void;
}) {
  const navigate = useNavigate();
  const gallery = useQuery({
    queryKey: ["gallery", item.id],
    queryFn: () => api.gallery(item.id),
    staleTime: GALLERY_STALE_MS,
    enabled: open,
  });
  const images = gallery.data?.images.length ? gallery.data.images : item.images;
  const was = previousPrice(item);
  const score = item.score != null ? Math.round(Math.max(0, Math.min(1, item.score)) * 100) : null;
  const reasons = (item.why ?? "").split(" · ").filter(Boolean);
  const meas = MEAS.filter(([k]) => item.measurements?.[k] != null);
  const seller = sellerLabel(item.seller?.rating ?? null, item.seller?.count ?? null);
  const hideSeller = sellerHide(item);
  const extra = gallery.data?.photo_count && gallery.data.photo_count > images.length ? gallery.data.photo_count - images.length : 0;

  const buy = (
    <div className="flex flex-col gap-2">
      {item.buy_links.map((link, i) => (
        <Button
          key={link.url}
          variant={i === 0 ? "primary" : "secondary"}
          size="lg"
          className="w-full justify-between"
          onClick={() => {
            const href = safeHref(link.url);
            if (href) window.open(href, "_blank", "noopener,noreferrer");
          }}
        >
          <span className="inline-flex items-center gap-2">
            <Icon name="buy" size={18} />
            Buy on {SOURCE_LABEL[link.source]}
            {link.size && <span className="font-normal opacity-60">· {link.size}</span>}
          </span>
          <span className="tabular">{formatGBP(link.price_gbp)}</span>
        </Button>
      ))}
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title={item.brand ?? SOURCE_LABEL[item.source]} size="full" footer={buy}>
      <div className="md:grid md:h-full md:grid-cols-[1.1fr_1fr]">
        <Photos images={images} title={item.title} loading={gallery.isFetching && images.length <= 1} />
        <div className="space-y-5 p-4 md:overflow-y-auto md:p-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-caption text-muted">
              <SourceBadge source={item.source} />
              {timeAgo(item.listed_at ?? item.first_seen_at)}
            </div>
            <h2 className="font-display text-title font-semibold">{item.title}</h2>
            <p className="flex items-baseline gap-2">
              <span className="tabular text-[26px] font-bold">{formatGBP(item.price_gbp)}</span>
              {was != null && <span className="tabular text-body text-muted line-through">{formatGBP(was)}</span>}
            </p>
            {item.landed && (item.landed.imported || item.landed.notes.length > 0) && (
              <p className="text-footnote text-muted">
                {item.landed.imported && (
                  <span className="font-medium text-warning">≈ {formatGBP(item.landed.total_gbp)} delivered (estimate). </span>
                )}
                {landedLines(item.landed).join(" · ")}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1">
            <VoteButtons vote={actions.vote} onVote={actions.castVote} />
            <IconButton label={actions.saved ? "Remove from saved" : "Save"} active={actions.saved} onClick={actions.toggleSave} className="bg-fill">
              <Icon name="bookmark" size={22} filled={actions.saved} />
            </IconButton>
            <ShareButton links={item.buy_links} title={item.title} className="bg-fill" />
            <IconButton
              label="Hunt for this"
              onClick={() => {
                onClose();
                navigate("/hunts", { state: { prefill: huntFromListing(item) } });
              }}
              className="bg-fill"
            >
              <Icon name="hunts" size={22} />
            </IconButton>
            <Menu
              trigger={(p) => (
                <IconButton label="More" className="bg-fill" {...p}>
                  <Icon name="more" size={22} />
                </IconButton>
              )}
              items={[
                ...(actions.saved && onBought ? [{ label: "I bought it", icon: <Icon name="bought" size={16} />, onSelect: onBought }] : []),
                ...(hideSeller?.available
                  ? [{ label: `Hide seller ${hideSeller.name}`, icon: <Icon name="hide" size={16} />, onSelect: () => { actions.hide("seller", hideSeller.name); onClose(); } }]
                  : hideSeller
                    ? [{ label: `Hide seller: ${hideSeller.reason}`, icon: <Icon name="hide" size={16} />, onSelect: () => {}, disabled: true }]
                    : []),
                ...(item.brand
                  ? [{ label: `Hide ${item.brand}`, icon: <Icon name="hide" size={16} />, onSelect: () => { actions.hide("brand", item.brand!); onClose(); } }]
                  : []),
              ]}
            />
          </div>
          {actions.error && <p className="text-footnote text-danger">{actions.error}</p>}

          {(score != null || reasons.length > 0) && (
            <div className="flex gap-4 rounded-group bg-surface p-4 dark:bg-elevated">
              {score != null && (
                <AnimatedCircularProgressBar
                  value={score}
                  gaugePrimaryColor="var(--accent)"
                  gaugeSecondaryColor="var(--fill-strong)"
                  className="size-14 shrink-0 text-footnote"
                  label={`${score}%`}
                />
              )}
              <div className="min-w-0 space-y-1">
                <p className="text-footnote font-semibold">Why it's here</p>
                <ul className="space-y-0.5 text-footnote text-muted">
                  {reasons.map((r) => (
                    <li key={r} className={cn(r.startsWith("⚠") && "text-warning")}>
                      {r.replace(/^⚠\s*/, "")}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-footnote">
            {item.size && <Detail label="Size" value={item.size} />}
            {item.condition && <Detail label="Condition" value={item.condition} />}
            {meas.map(([k, label]) => (
              <Detail key={k} label={label} value={`${Math.round(item.measurements[k]!)} cm`} accent />
            ))}
            {item.seller?.name && <Detail label="Seller" value={`${item.seller.name}${seller ? ` · ${seller}` : ""}`} />}
            {item.country && <Detail label="Ships from" value={item.country} />}
          </dl>

          {gallery.data?.description && (
            <div>
              <p className="mb-1 text-footnote font-semibold">Description</p>
              <p className="text-footnote whitespace-pre-line text-muted">{gallery.data.description}</p>
            </div>
          )}
          {(gallery.data?.note || extra > 0) && (
            <p className="text-footnote text-muted">
              {gallery.data?.note}
              {extra > 0 && ` ${extra} more photo${extra === 1 ? " is" : "s are"} only on ${SOURCE_LABEL[item.source]}.`}
            </p>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Detail({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className={cn("truncate", accent && "tabular")}>{value}</dd>
    </div>
  );
}
