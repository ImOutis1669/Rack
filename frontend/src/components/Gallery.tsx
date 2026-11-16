import { useQuery } from "@tanstack/react-query";
import { safeHref } from "../lib/safe";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Listing } from "../api/types";
import { formatGBP, SOURCE_LABEL } from "../lib/format";
import { landedLines } from "../lib/landed";

/** Full-screen photo viewer: swipe / scroll / arrow keys through every photo of a listing. */
export function Gallery({ item, onClose }: { item: Listing; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["gallery", item.id],
    queryFn: () => api.gallery(item.id),
    staleTime: 10 * 60_000,
  });
  const images = q.data?.images.length ? q.data.images : item.images;
  const [index, setIndex] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const target = useRef<number | null>(null); // where a button/key scroll is heading

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
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goTo(index + 1);
      if (e.key === "ArrowLeft") goTo(index - 1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [goTo, index, onClose]);

  const onScroll = () => {
    const el = strip.current;
    if (!el) return;
    const at = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (target.current !== null) {
      if (at === target.current) target.current = null; // programmatic scroll arrived
      return;
    }
    setIndex(at); // finger / trackpad swipe
  };

  const extra =
    q.data?.photo_count && q.data.photo_count > images.length ? q.data.photo_count - images.length : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      className="fixed inset-0 z-50 flex flex-col bg-black pt-[env(safe-area-inset-top)]"
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
        <span className="tabular-nums text-neutral-400">
          {images.length ? `${index + 1} / ${images.length}` : "No photos"}
          {q.isFetching && <span className="ml-2 text-neutral-500">loading more…</span>}
        </span>
        <span className="line-clamp-1 flex-1 text-center text-neutral-300">{item.title}</span>
        <button aria-label="Close" onClick={onClose} className="px-2 text-xl leading-none text-neutral-300">
          ✕
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={strip}
          onScroll={onScroll}
          className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-contain [scrollbar-width:none]"
        >
          {images.map((src, i) => (
            <div key={src} className="flex h-full w-full shrink-0 snap-center items-center justify-center">
              <img
                src={src}
                alt={`${item.title} — photo ${i + 1}`}
                loading={Math.abs(i - index) <= 1 ? "eager" : "lazy"}
                referrerPolicy="no-referrer"
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ))}
        </div>
        {images.length > 1 && (
          <>
            <button
              aria-label="Previous photo"
              onClick={() => goTo(index - 1)}
              disabled={index === 0}
              className="absolute left-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-xl disabled:opacity-20 sm:block"
            >
              ‹
            </button>
            <button
              aria-label="Next photo"
              onClick={() => goTo(index + 1)}
              disabled={index === images.length - 1}
              className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded-full bg-white/10 px-3 py-2 text-xl disabled:opacity-20 sm:block"
            >
              ›
            </button>
          </>
        )}
      </div>

      {images.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto px-3 py-2">
          {images.map((src, i) => (
            <button
              key={src}
              aria-label={`Photo ${i + 1}`}
              onClick={() => goTo(i)}
              className={`h-14 w-11 shrink-0 overflow-hidden rounded ring-2 ${i === index ? "ring-white" : "ring-transparent opacity-60"}`}
            >
              <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      <div className="max-h-[30vh] space-y-2 overflow-y-auto px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] text-sm">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-base font-semibold">{formatGBP(item.price_gbp)}</span>
          <span className="text-xs text-neutral-400">
            {[item.brand, item.size && `Size ${item.size}`, item.condition].filter(Boolean).join(" · ")}
          </span>
        </div>
        {item.landed && (item.landed.imported || item.landed.shipping_gbp) && (
          <p className="text-xs text-neutral-400">
            <span className="text-neutral-200">≈ {formatGBP(item.landed.total_gbp)} delivered (estimate)</span>
            {" · "}
            {landedLines(item.landed).join(" · ")}
          </p>
        )}
        {(q.data?.note || extra > 0) && (
          <p className="text-xs text-amber-300/90">
            {q.data?.note}
            {extra > 0 &&
              ` ${extra} more photo${extra === 1 ? " is" : "s are"} only viewable on ${SOURCE_LABEL[item.source]}.`}
          </p>
        )}
        {q.data?.description && (
          <p className="whitespace-pre-line text-xs leading-relaxed text-neutral-300">{q.data.description}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {item.buy_links.map((link) => (
            <a
              key={link.url}
              href={safeHref(link.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-white px-3 py-1.5 text-xs font-semibold text-black"
            >
              Open on {SOURCE_LABEL[link.source]}
              {item.buy_links.length > 1 && ` · ${formatGBP(link.price_gbp)}`}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
