import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { CATEGORIES, type Category, type FeedParams, type Sort, type Source } from "../api/types";
import { HealthPill } from "../components/HealthPill";
import { ListingCard } from "../components/ListingCard";
import { Nav } from "../components/Nav";
import { RefreshButton } from "../components/RefreshButton";
import { SOURCE_LABEL } from "../lib/format";
import { SeenBatcher } from "../lib/seen";

const SOURCES: Source[] = ["ebay", "vinted", "grailed", "vestiaire"];
const chip = (on: boolean) =>
  `rounded-full px-2.5 py-1 ring-1 ${on ? "bg-white text-black ring-white" : "ring-white/20"}`;

export function Feed({ onLogout }: { onLogout: () => void }) {
  const [params, setParams] = useState<FeedParams>({
    sort: "best",
    sources: [],
    maxPrice: null,
    category: null,
    brand: "",
  });
  const [newOnly, setNewOnly] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<number>>(new Set());

  const visit = useQuery({ queryKey: ["visit"], queryFn: api.visit, staleTime: Infinity });
  const profile = useQuery({ queryKey: ["profile"], queryFn: api.profile });

  const effective: FeedParams = {
    ...params,
    hideSeenBefore: visit.data?.visit_start ?? null,
    newSince: newOnly ? (visit.data?.last_visit ?? null) : null,
  };
  const query = useInfiniteQuery({
    queryKey: ["feed", effective],
    queryFn: ({ pageParam }) => api.feed(effective, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: visit.isSuccess || visit.isError,
    staleTime: Infinity, // ranking order must not reshuffle under you while scrolling
  });

  const batcher = useMemo(() => new SeenBatcher(api.seen), []);
  useEffect(() => {
    const flush = () => void batcher.flush();
    const onVis = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      flush();
    };
  }, [batcher]);
  const onSeen = useCallback((id: number) => batcher.add(id), [batcher]);
  const onHidden = useCallback((id: number) => setHiddenIds((s) => new Set(s).add(id)), []);

  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage();
        }
      },
      { rootMargin: "800px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [query]);

  const toggleSource = (s: Source) =>
    setParams((p) => ({
      ...p,
      sources: p.sources.includes(s) ? p.sources.filter((x) => x !== s) : [...p.sources, s],
    }));

  const items = (query.data?.pages.flatMap((p) => p.items) ?? []).filter((i) => !hiddenIds.has(i.id));
  const needsSetup = profile.data && profile.data.designer_count === 0 && profile.data.taste_count === 0;

  return (
    <div className="mx-auto max-w-6xl px-3 pb-16">
      <header className="sticky top-0 z-10 -mx-3 space-y-2 bg-neutral-950/90 px-3 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)] backdrop-blur">
        <Nav onLogout={onLogout} />
        <HealthPill />
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <RefreshButton />
          <select
            aria-label="Sort"
            value={params.sort}
            onChange={(e) => setParams((p) => ({ ...p, sort: e.target.value as Sort }))}
            className="rounded-full bg-neutral-900 px-2.5 py-1 ring-1 ring-white/20"
          >
            <option value="best">For you</option>
            <option value="newest">Newest</option>
            <option value="price_asc">Price ↑</option>
            <option value="price_desc">Price ↓</option>
          </select>
          <select
            aria-label="Category"
            value={params.category ?? ""}
            onChange={(e) => setParams((p) => ({ ...p, category: (e.target.value || null) as Category | null }))}
            className="rounded-full bg-neutral-900 px-2.5 py-1 capitalize ring-1 ring-white/20"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {SOURCES.map((s) => (
            <button key={s} onClick={() => toggleSource(s)} className={chip(params.sources.includes(s))}>
              {SOURCE_LABEL[s]}
            </button>
          ))}
          <button
            onClick={() => setNewOnly((v) => !v)}
            disabled={!visit.data?.last_visit}
            className={`${chip(newOnly)} disabled:opacity-40`}
            title={visit.data?.last_visit ? "Only items found since your last visit" : "No earlier visit yet"}
          >
            New since last visit
          </button>
          <input
            aria-label="Brand"
            placeholder="Brand"
            className="w-24 rounded-full bg-neutral-900 px-2.5 py-1 ring-1 ring-white/20"
            onChange={(e) => setParams((p) => ({ ...p, brand: e.target.value }))}
          />
          <input
            aria-label="Max price"
            type="number"
            inputMode="numeric"
            placeholder="Max £"
            className="w-20 rounded-full bg-neutral-900 px-2.5 py-1 ring-1 ring-white/20"
            onChange={(e) =>
              setParams((p) => ({ ...p, maxPrice: e.target.value ? Number(e.target.value) : null }))
            }
          />
        </div>
      </header>

      {needsSetup && (
        <div className="mt-3 rounded-lg bg-neutral-900 p-3 text-sm ring-1 ring-white/10">
          <p className="font-medium">Teach Rack your taste</p>
          <p className="mt-1 text-neutral-400">
            Add designers and your measurements in{" "}
            <Link to="/settings" className="underline">
              Settings
            </Link>
            , then upload photos of clothes you own or want under{" "}
            <Link to="/taste" className="underline">
              Wardrobe
            </Link>
            . Until then the feed is unranked.
          </p>
        </div>
      )}

      {query.isError && <p className="mt-6 text-sm text-red-400">Couldn't load feed: {String(query.error)}</p>}
      {query.isSuccess && items.length === 0 && (
        <p className="mt-10 text-center text-sm text-neutral-400">
          Nothing new to show. Sources refresh every 30 minutes; items you've already seen stay hidden.
        </p>
      )}

      <div className="mt-2 columns-2 gap-3 sm:columns-3 lg:columns-4">
        {items.map((item) => (
          <ListingCard key={item.id} item={item} onSeen={onSeen} onHidden={onHidden} />
        ))}
      </div>
      <div ref={sentinel} className="h-10" />
      {query.isFetchingNextPage && <p className="text-center text-xs text-neutral-500">Loading…</p>}
    </div>
  );
}
