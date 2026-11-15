import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { FeedParams, Sort, Source } from "../api/types";
import { HealthPill } from "../components/HealthPill";
import { ListingCard } from "../components/ListingCard";
import { SOURCE_LABEL } from "../lib/format";

const SOURCES: Source[] = ["ebay", "vinted", "grailed", "vestiaire"];

export function Feed({ onLogout }: { onLogout: () => void }) {
  const [params, setParams] = useState<FeedParams>({ sort: "newest", sources: [], maxPrice: null });
  const query = useInfiniteQuery({
    queryKey: ["feed", params],
    queryFn: ({ pageParam }) => api.feed(params, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });

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

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto max-w-6xl px-3 pb-16">
      <header className="sticky top-0 z-10 -mx-3 space-y-2 bg-neutral-950/90 px-3 pb-2 pt-[max(env(safe-area-inset-top),0.75rem)] backdrop-blur">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold tracking-tight">Rack</h1>
          <button onClick={onLogout} className="text-xs text-neutral-400">
            Log out
          </button>
        </div>
        <HealthPill />
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {SOURCES.map((s) => (
            <button
              key={s}
              onClick={() => toggleSource(s)}
              className={`rounded-full px-2.5 py-1 ring-1 ${
                params.sources.includes(s) ? "bg-white text-black ring-white" : "ring-white/20"
              }`}
            >
              {SOURCE_LABEL[s]}
            </button>
          ))}
          <select
            aria-label="Sort"
            value={params.sort}
            onChange={(e) => setParams((p) => ({ ...p, sort: e.target.value as Sort }))}
            className="rounded-full bg-neutral-900 px-2.5 py-1 ring-1 ring-white/20"
          >
            <option value="newest">Newest</option>
            <option value="price_asc">Price ↑</option>
            <option value="price_desc">Price ↓</option>
          </select>
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

      {query.isError && <p className="mt-6 text-sm text-red-400">Couldn't load feed: {String(query.error)}</p>}
      {query.isSuccess && items.length === 0 && (
        <p className="mt-10 text-center text-sm text-neutral-400">
          Nothing yet. Sources refresh every 30 minutes — check source health above.
        </p>
      )}

      <div className="mt-2 columns-2 gap-3 sm:columns-3 lg:columns-4">
        {items.map((item) => (
          <ListingCard key={item.id} item={item} />
        ))}
      </div>
      <div ref={sentinel} className="h-10" />
      {query.isFetchingNextPage && <p className="text-center text-xs text-neutral-500">Loading…</p>}
    </div>
  );
}
