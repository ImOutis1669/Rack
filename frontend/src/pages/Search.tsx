// Search across all sources (v2.1). Opened from the magnifying glass in the feed's top bar.
// Instant: everything Rack already has, as you type. Live: "Search eBay, Vinted and Grailed
// now" asks each site once (the worker, at the crawler's polite pace); what it finds joins the
// results as each site answers.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SOURCE_LABEL } from "@rack/shared/format";
import { addRecent, cleanQuery, huntFromSearch, liveFinished, liveSummary } from "@rack/shared/search";
import { CATEGORIES, type Category, type Listing, type SearchParams, type SearchSort, type Source } from "@rack/shared/types";
import { api, ApiError } from "../api/client";
import { PageShell } from "../components/AppShell";
import { Icon } from "../components/icons/Icon";
import { ListingItem } from "../components/ListingItem";
import { toast } from "../components/Toast";
import { Button, Chip, EmptyState, Field, Input, Menu, Sheet, Skeleton } from "../components/ui";
import { VirtualGrid } from "../components/VirtualGrid";
import { loadRecent, saveRecent } from "../lib/recentSearches";

const SORTS: [SearchSort, string][] = [
  ["best", "Best match"],
  ["newest", "Newest"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
];
const SOURCES: Source[] = ["ebay", "vinted", "grailed"];
const CATEGORY_LABEL: Record<Category, string> = {
  any: "All",
  tops: "Tops",
  trousers: "Trousers",
  shoes: "Shoes",
  outerwear: "Outerwear",
  accessories: "Accessories",
};
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Search() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [params, setParams] = useState<Omit<SearchParams, "q">>({ sort: "best", sources: [], category: null, size: null, maxPrice: null });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [recent, setRecent] = useState(loadRecent);
  const [liveId, setLiveId] = useState<number | null>(null);
  const q = cleanQuery(useDebounced(text, 250));
  const full: SearchParams = useMemo(() => ({ ...params, q }), [params, q]);

  const results = useInfiniteQuery({
    queryKey: ["search", full],
    queryFn: ({ pageParam }) => api.search(full, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: !!q,
    staleTime: 30_000,
  });
  const live = useQuery({
    queryKey: ["live-search", liveId],
    queryFn: () => api.liveSearchStatus(liveId as number),
    enabled: liveId != null,
    refetchInterval: (query) => (liveFinished(query.state.data) ? false : 2000),
  });
  // a finished live search: its listings are stored now, so the instant results include them
  const liveDone = liveFinished(live.data);
  useEffect(() => {
    if (liveDone) void qc.invalidateQueries({ queryKey: ["search"] });
  }, [liveDone, qc]);
  // a new query is a new search: forget the last live one
  useEffect(() => setLiveId(null), [q]);

  const startLive = useMutation({
    mutationFn: () => api.liveSearch(q, { category: params.category, maxPrice: params.maxPrice }),
    onSuccess: (s) => {
      setLiveId(s.id);
      qc.setQueryData(["live-search", s.id], s);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 429 && e.retryAfter) toast(`You can search the marketplaces again in ${e.retryAfter} s`);
      else toast(e instanceof Error ? e.message : "Couldn't start the search");
    },
  });

  const remember = (value = text) => {
    const next = addRecent(recent, value);
    setRecent(next);
    saveRecent(next);
  };
  const loadMore = useCallback(() => {
    if (results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
  }, [results]);

  useEffect(() => input.current?.focus(), []);

  const instant = results.data?.pages.flatMap((p) => p.items) ?? [];
  const seen = new Set(instant.map((i) => i.id));
  const fresh = (live.data?.items ?? []).filter((i) => !seen.has(i.id));
  const items: Listing[] = [...fresh, ...instant];
  const filterCount = (params.category ? 1 : 0) + (params.size?.trim() ? 1 : 0) + (params.maxPrice != null ? 1 : 0);
  const running = liveId != null && !liveDone;

  const header = (
    <div className="space-y-2.5">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          remember();
          input.current?.blur();
        }}
        className="relative"
      >
        <Icon name="find" size={18} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
        <Input
          ref={input}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Designers, items, sizes"
          aria-label="Search all sources"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="pl-10 text-[16px]"
        />
      </form>
      {q && (
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0">
          <Menu
            align="left"
            trigger={(p) => (
              <Chip selected={params.sort !== "best"} {...p}>
                <Icon name="sort" size={15} />
                {SORTS.find(([s]) => s === params.sort)?.[1]}
                <Icon name="chevron-down" size={14} className="opacity-60" />
              </Chip>
            )}
            items={SORTS.map(([s, label]) => ({
              label,
              icon: s === params.sort ? <Icon name="check" size={16} /> : <span className="w-4" />,
              onSelect: () => setParams((p) => ({ ...p, sort: s })),
            }))}
          />
          <Chip selected={filterCount > 0} onClick={() => setFiltersOpen(true)}>
            <Icon name="filters" size={15} />
            Filters{filterCount > 0 && ` · ${filterCount}`}
          </Chip>
          <span aria-hidden className="mx-0.5 my-2 w-px shrink-0 bg-border" />
          {SOURCES.map((s) => (
            <Chip
              key={s}
              selected={params.sources.includes(s)}
              onClick={() =>
                setParams((p) => ({ ...p, sources: p.sources.includes(s) ? p.sources.filter((x) => x !== s) : [...p.sources, s] }))
              }
            >
              {SOURCE_LABEL[s]}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <PageShell title="Search" below={header}>
      {!q && (
        <div className="mx-auto max-w-lg">
          {recent.length > 0 ? (
            <section>
              <div className="flex items-center justify-between px-1 pb-1">
                <h2 className="text-footnote font-medium text-muted uppercase tracking-wide">Recent</h2>
                <button
                  type="button"
                  className="press min-h-11 px-1 text-footnote text-muted"
                  onClick={() => {
                    setRecent([]);
                    saveRecent([]);
                  }}
                >
                  Clear
                </button>
              </div>
              <ul className="divide-y divide-border">
                {recent.map((r) => (
                  <li key={r}>
                    <button type="button" className="press flex min-h-11 w-full items-center gap-3 px-1 text-left text-body" onClick={() => setText(r)}>
                      <Icon name="find" size={16} className="text-muted" />
                      {r}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <EmptyState icon={<Icon name="find" size={24} />} title="Search eBay, Vinted and Grailed">
              Everything Rack has found so far, as you type. Ask the sites directly when you need what was listed in the last
              few minutes.
            </EmptyState>
          )}
        </div>
      )}

      {q && (
        <LiveBar
          running={running}
          summary={live.data && Object.keys(live.data.results).length ? liveSummary(live.data) : ""}
          found={live.data?.items.length ?? 0}
          done={liveDone}
          busy={startLive.isPending}
          onStart={() => {
            remember();
            startLive.mutate();
          }}
          onHunt={() => navigate("/hunts", { state: { prefill: huntFromSearch(full) } })}
        />
      )}

      {q && results.isPending && (
        <div className="grid grid-cols-2 gap-x-3 md:grid-cols-4">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="mb-5 aspect-[4/5]" />
          ))}
        </div>
      )}
      {q && results.isError && (
        <EmptyState icon={<Icon name="search" size={24} />} title="Search isn't working right now">
          {results.error instanceof Error ? results.error.message : "Try again in a moment."}
        </EmptyState>
      )}
      {q && results.isSuccess && items.length === 0 && !running && (
        <EmptyState icon={<Icon name="search" size={24} />} title={`Nothing for "${q}" yet`}>
          Rack hasn't seen anything like it. Ask the marketplaces directly, or save it as a hunt to hear when one turns up.
        </EmptyState>
      )}
      {q && (
        <VirtualGrid
          items={items}
          getKey={(item) => item.id}
          memoryKey={`search:${JSON.stringify(full)}`}
          onNearEnd={loadMore}
          renderItem={(item, i) => <ListingItem item={item} index={i} />}
        />
      )}
      {results.isFetchingNextPage && <p className="py-4 text-center text-footnote text-muted">Loading more</p>}

      <Filters
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        params={params}
        onApply={(p) => {
          setParams(p);
          setFiltersOpen(false);
        }}
      />
    </PageShell>
  );
}

function LiveBar(props: {
  running: boolean;
  done: boolean;
  summary: string;
  found: number;
  busy: boolean;
  onStart: () => void;
  onHunt: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Button size="sm" variant={props.running ? "secondary" : "primary"} disabled={props.running || props.busy} onClick={props.onStart}>
        <Icon name="refresh" size={15} className={props.running ? "animate-spin" : undefined} />
        {props.running ? "Asking eBay, Vinted and Grailed" : props.done ? "Ask again" : "Search eBay, Vinted and Grailed now"}
      </Button>
      <Button size="sm" variant="plain" onClick={props.onHunt}>
        <Icon name="hunts" size={15} /> Save as hunt
      </Button>
      {(props.summary || props.done) && (
        <p className="w-full text-footnote text-muted tabular" aria-live="polite">
          {props.done ? `${props.found} found just now` : "Found so far"}
          {props.summary && ` · ${props.summary}`}
        </p>
      )}
    </div>
  );
}

function Filters({
  open,
  onClose,
  params,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  params: Omit<SearchParams, "q">;
  onApply: (p: Omit<SearchParams, "q">) => void;
}) {
  const [category, setCategory] = useState<Category>(params.category ?? "any");
  const [size, setSize] = useState(params.size ?? "");
  const [max, setMax] = useState(params.maxPrice != null ? String(params.maxPrice) : "");
  useEffect(() => {
    if (!open) return;
    setCategory(params.category ?? "any");
    setSize(params.size ?? "");
    setMax(params.maxPrice != null ? String(params.maxPrice) : "");
  }, [open, params]);
  const maxPrice = max.trim() && Number.isFinite(Number(max)) ? Number(max) : null;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Filters"
      footer={
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => onApply({ ...params, category: null, size: null, maxPrice: null })}>
            Clear
          </Button>
          <Button className="flex-1" variant="primary" onClick={() => onApply({ ...params, category: category === "any" ? null : category, size: size.trim() || null, maxPrice })}>
            Show results
          </Button>
        </div>
      }
    >
      <div className="space-y-5 p-4">
        <Field label="Category">
          {() => (
            <div className="flex flex-wrap gap-2">
              {(["any", ...CATEGORIES] as Category[]).map((c) => (
                <Chip key={c} selected={category === c} onClick={() => setCategory(c)}>
                  {CATEGORY_LABEL[c]}
                </Chip>
              ))}
            </div>
          )}
        </Field>
        <Field label="Size" hint="Matches the listing's size, e.g. 43, M or 32.">
          {(id) => <Input id={id} value={size} maxLength={30} autoCapitalize="none" onChange={(e) => setSize(e.target.value)} className="text-[16px]" />}
        </Field>
        <Field label="Maximum price (£)">
          {(id) => <Input id={id} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value.replace(/[^\d.]/g, ""))} className="text-[16px] tabular" />}
        </Field>
      </div>
    </Sheet>
  );
}
