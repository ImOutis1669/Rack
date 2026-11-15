import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { Listing } from "../api/types";
import { formatGBP, sellerLabel, SOURCE_LABEL, timeAgo } from "../lib/format";
import { Carousel } from "./Carousel";
import { SourceBadge } from "./SourceBadge";

const MEAS: [keyof Listing["measurements"], string][] = [
  ["inseam_cm", "inseam"],
  ["sleeve_cm", "sleeve"],
  ["p2p_cm", "p2p"],
  ["length_cm", "length"],
];

interface Props {
  item: Listing;
  onSeen?: (id: number) => void;
  onHidden?: (id: number) => void;
}

export function ListingCard({ item, onSeen, onHidden }: Props) {
  const seller = sellerLabel(item.seller?.rating ?? null, item.seller?.count ?? null);
  const [vote, setVote] = useState(item.feedback);
  const [saved, setSaved] = useState(item.saved);
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

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

  const run = async (fn: () => Promise<unknown>, undo: () => void) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      undo();
      setError(String((e as Error).message));
    }
  };

  const castVote = (v: -1 | 1) => {
    const prev = vote;
    const next = vote === v ? null : v;
    setVote(next);
    void run(() => api.feedback(item.id, next ?? 0), () => setVote(prev));
  };

  const toggleSave = () => {
    const prev = saved;
    setSaved(!saved);
    void run(() => (prev ? api.unsave(item.id) : api.save(item.id)), () => setSaved(prev));
  };

  const hide = (kind: "seller" | "brand", value: string) => {
    setMenu(false);
    void run(
      async () => {
        await api.hide(kind, value);
        onHidden?.(item.id);
      },
      () => undefined,
    );
  };

  const drop =
    item.price_gbp_at_save && item.price_gbp && Number(item.price_gbp) < Number(item.price_gbp_at_save)
      ? Number(item.price_gbp_at_save)
      : null;
  const meas = MEAS.filter(([k]) => item.measurements?.[k] != null);

  return (
    <article
      ref={ref}
      className="mb-3 break-inside-avoid overflow-hidden rounded-lg bg-neutral-900 ring-1 ring-white/5"
    >
      <Carousel images={item.images} alt={item.title} />
      <div className="space-y-1.5 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <SourceBadge source={item.source} />
          <span className="text-[11px] text-neutral-400">{timeAgo(item.listed_at ?? item.first_seen_at)}</span>
        </div>
        <h3 className="line-clamp-2 text-sm leading-snug">{item.title}</h3>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-base font-semibold">
            {formatGBP(item.price_gbp)}
            {drop != null && (
              <span className="ml-1.5 text-xs font-normal text-emerald-400 line-through decoration-neutral-500">
                {formatGBP(drop)}
              </span>
            )}
          </span>
          {item.score != null && (
            <span className="text-xs text-emerald-400" title="Match score">
              {Math.round(Math.max(0, Math.min(1, item.score)) * 100)}%
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-2 text-[11px] text-neutral-400">
          {item.size && <span>Size {item.size}</span>}
          {meas.map(([k, label]) => (
            <span key={k} className="text-neutral-300">
              {label} {Math.round(item.measurements[k]!)}cm
            </span>
          ))}
          {item.condition && <span>{item.condition}</span>}
          {item.shipping_cost_gbp && <span>+{formatGBP(item.shipping_cost_gbp)} post</span>}
          {seller && <span>★ {seller}</span>}
        </div>
        {item.why && (
          <p className="text-[11px] leading-snug text-neutral-300">
            <span className="text-neutral-500">Why: </span>
            {item.why}
          </p>
        )}
        {error && <p className="text-[11px] text-red-400">{error}</p>}
        <div className="flex items-center gap-1 pt-1 text-sm">
          <button
            aria-label="More like this"
            aria-pressed={vote === 1}
            onClick={() => castVote(1)}
            className={`rounded px-2 py-1 ${vote === 1 ? "bg-emerald-600/40" : "bg-neutral-800"}`}
          >
            👍
          </button>
          <button
            aria-label="Less like this"
            aria-pressed={vote === -1}
            onClick={() => castVote(-1)}
            className={`rounded px-2 py-1 ${vote === -1 ? "bg-red-600/40" : "bg-neutral-800"}`}
          >
            👎
          </button>
          <button
            aria-label={saved ? "Unsave" : "Save"}
            aria-pressed={saved}
            onClick={toggleSave}
            className={`rounded px-2 py-1 ${saved ? "bg-amber-500/40" : "bg-neutral-800"}`}
          >
            {saved ? "★" : "☆"}
          </button>
          <div className="relative">
            <button
              aria-label="More actions"
              onClick={() => setMenu((m) => !m)}
              className="rounded bg-neutral-800 px-2 py-1"
            >
              ⋯
            </button>
            {menu && (
              <div className="absolute bottom-9 left-0 z-20 w-40 overflow-hidden rounded-md bg-neutral-800 text-xs shadow-lg ring-1 ring-white/10">
                {item.seller?.name && (
                  <button className="block w-full px-3 py-2 text-left hover:bg-neutral-700" onClick={() => hide("seller", item.seller!.name!)}>
                    Hide seller {item.seller.name}
                  </button>
                )}
                {item.brand && (
                  <button className="block w-full px-3 py-2 text-left hover:bg-neutral-700" onClick={() => hide("brand", item.brand!)}>
                    Hide brand {item.brand}
                  </button>
                )}
                {!item.seller?.name && !item.brand && <p className="px-3 py-2 text-neutral-400">Nothing to hide</p>}
              </div>
            )}
          </div>
          {item.buy_links.length === 1 && (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto flex-1 rounded bg-white py-1.5 text-center text-xs font-semibold text-black active:bg-neutral-300"
            >
              Buy
            </a>
          )}
        </div>
        {item.buy_links.length > 1 && (
          <div className="space-y-1 pt-0.5">
            <p className="text-[11px] text-neutral-400">Listed {item.buy_links.length} times</p>
            {item.buy_links.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex justify-between rounded bg-white px-2 py-1.5 text-xs font-semibold text-black active:bg-neutral-300"
              >
                <span>
                  Buy on {SOURCE_LABEL[link.source]}
                  {link.size && <span className="font-normal text-neutral-600"> · {link.size}</span>}
                </span>
                <span>{formatGBP(link.price_gbp)}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
