import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowDownWideNarrow, Check, ChevronDown, SearchX, SlidersHorizontal, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { CATEGORIES, type Category, type FeedParams, type Sort, type Source } from "../api/types";
import { PageShell } from "../components/AppShell";
import { ListingGrid, ListingItem } from "../components/ListingItem";
import { RefreshButton } from "../components/RefreshButton";
import { SourcesButton } from "../components/SourcesButton";
import { Button, Chip, EmptyState, Field, Input, Menu, Sheet, Skeleton, Switch } from "../components/ui";
import { SOURCE_LABEL } from "../lib/format";
import { SeenBatcher } from "../lib/seen";

const SOURCES: Source[] = ["ebay", "vinted", "grailed", "vestiaire"];
const SORTS: [Sort, string][] = [
  ["best", "For you"],
  ["newest", "Newest"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
];
const CATEGORY_LABEL: Record<Category, string> = {
  any: "All",
  tops: "Tops",
  trousers: "Trousers",
  shoes: "Shoes",
  outerwear: "Outerwear",
};

/** The feed is the app's home: its title is the app name (the sort menu keeps "For you"). */
export const FEED_TITLE = "Rack";

export function Feed() {
  const [params, setParams] = useState<FeedParams>({ sort: "best", sources: [], maxPrice: null, category: null, brand: "" });
  const [newOnly, setNewOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
        if (entries[0]?.isIntersecting && query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
      },
      { rootMargin: "1200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [query]);

  const items = (query.data?.pages.flatMap((p) => p.items) ?? []).filter((i) => !hiddenIds.has(i.id));
  const needsSetup = profile.data && profile.data.designer_count === 0 && profile.data.taste_count === 0;
  const filterCount = params.sources.length + (params.brand?.trim() ? 1 : 0) + (params.maxPrice != null ? 1 : 0) + (newOnly ? 1 : 0);
  const sortLabel = SORTS.find(([s]) => s === params.sort)?.[1] ?? "For you";

  const chips = (
    <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
      <Menu
        align="left"
        trigger={(p) => (
          <Chip selected={params.sort !== "best"} {...p}>
            <ArrowDownWideNarrow size={15} />
            {sortLabel}
            <ChevronDown size={14} className="opacity-60" />
          </Chip>
        )}
        items={SORTS.map(([s, label]) => ({
          label,
          icon: s === params.sort ? <Check size={16} /> : <span className="w-4" />,
          onSelect: () => setParams((p) => ({ ...p, sort: s })),
        }))}
      />
      <Chip selected={filterCount > 0} onClick={() => setFiltersOpen(true)}>
        <SlidersHorizontal size={15} />
        Filters{filterCount > 0 && ` · ${filterCount}`}
      </Chip>
      <span aria-hidden className="mx-0.5 my-2 w-px shrink-0 bg-border" />
      {(["any", ...CATEGORIES] as Category[]).map((c) => (
        <Chip
          key={c}
          selected={(params.category ?? "any") === c}
          onClick={() => setParams((p) => ({ ...p, category: c === "any" ? null : c }))}
        >
          {CATEGORY_LABEL[c]}
        </Chip>
      ))}
    </div>
  );

  return (
    <PageShell
      title={FEED_TITLE}
      desktopTitle={false}
      actions={
        <>
          <SourcesButton />
          <RefreshButton />
        </>
      }
      below={chips}
    >
      {needsSetup && (
        <div className="mb-6 flex flex-col gap-4 rounded-group bg-surface p-5 md:flex-row md:items-center">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-fill">
            <Sparkles size={20} />
          </div>
          <div className="flex-1">
            <p className="text-headline font-semibold">Teach Rack your taste</p>
            <p className="text-footnote text-muted">
              Add the designers you like and your measurements, then a few photos of clothes you own or want. Until then the feed is unranked.
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/settings">
              <Button variant="primary" size="sm">Designers and fit</Button>
            </Link>
            <Link to="/taste">
              <Button size="sm">Add photos</Button>
            </Link>
          </div>
        </div>
      )}

      {query.isError && (
        <EmptyState icon={<SearchX size={24} />} title="Couldn't load the feed" action={<Button onClick={() => void query.refetch()}>Try again</Button>}>
          {String((query.error as Error).message)}
        </EmptyState>
      )}

      {query.isPending && !query.isError && (
        <ListingGrid>
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="mb-5 break-inside-avoid space-y-2">
              <Skeleton className="aspect-[4/5]" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}
        </ListingGrid>
      )}

      {query.isSuccess && items.length === 0 && (
        <EmptyState icon={<Sparkles size={24} />} title="You're all caught up">
          Sources are searched every 30 minutes, and things you've already seen stay hidden until your next visit. Pull in new listings with Refresh.
        </EmptyState>
      )}

      <ListingGrid>
        {items.map((item, i) => (
          <ListingItem key={item.id} item={item} index={i} onSeen={onSeen} onHidden={onHidden} />
        ))}
      </ListingGrid>
      <div ref={sentinel} className="h-10" />
      {query.isFetchingNextPage && <p className="py-4 text-center text-footnote text-muted">Loading more</p>}

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        footer={
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => {
                setParams((p) => ({ ...p, sources: [], brand: "", maxPrice: null }));
                setNewOnly(false);
              }}
            >
              Clear
            </Button>
            <Button variant="primary" className="flex-1" onClick={() => setFiltersOpen(false)}>
              Show results
            </Button>
          </div>
        }
      >
        <div className="space-y-6 p-4">
          <div className="space-y-2">
            <p className="text-footnote font-medium text-muted">Sources</p>
            <div className="flex flex-wrap gap-2">
              {SOURCES.map((s) => (
                <Chip
                  key={s}
                  selected={params.sources.includes(s)}
                  onClick={() =>
                    setParams((p) => ({
                      ...p,
                      sources: p.sources.includes(s) ? p.sources.filter((x) => x !== s) : [...p.sources, s],
                    }))
                  }
                >
                  {SOURCE_LABEL[s]}
                </Chip>
              ))}
            </div>
            <p className="text-caption text-muted">None selected shows every source.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Brand">
              {(id) => (
                <Input id={id} placeholder="Any" value={params.brand ?? ""} onChange={(e) => setParams((p) => ({ ...p, brand: e.target.value }))} />
              )}
            </Field>
            <Field label="Max price (£)">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  placeholder="Any"
                  value={params.maxPrice ?? ""}
                  onChange={(e) => setParams((p) => ({ ...p, maxPrice: e.target.value ? Number(e.target.value) : null }))}
                />
              )}
            </Field>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-body">New since last visit</p>
              <p className="text-footnote text-muted">
                {visit.data?.last_visit ? "Only items found since you were last here." : "Available after your next visit."}
              </p>
            </div>
            <Switch checked={newOnly} onChange={(v) => visit.data?.last_visit && setNewOnly(v)} label="New since last visit" />
          </div>
        </div>
      </Sheet>
    </PageShell>
  );
}
