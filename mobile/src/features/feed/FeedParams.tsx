import type { FeedParams } from '@rack/shared/types';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export const DEFAULT_PARAMS: FeedParams = { sort: 'best', sources: [], maxPrice: null, category: null, brand: '' };

interface FeedState {
  params: FeedParams;
  setParams: (fn: (p: FeedParams) => FeedParams) => void;
  newOnly: boolean;
  setNewOnly: (v: boolean) => void;
  /** Filters sheet badge: sources + brand + max price + new only (the web's count). */
  filterCount: number;
  clearFilters: () => void;
}

const Ctx = createContext<FeedState | null>(null);

/** Feed filters, shared by the feed and its Filters sheet (both in the feed tab's stack). */
export function FeedParamsProvider({ children }: { children: ReactNode }) {
  const [params, setParamsState] = useState<FeedParams>(DEFAULT_PARAMS);
  const [newOnly, setNewOnly] = useState(false);
  const value = useMemo<FeedState>(
    () => ({
      params,
      setParams: (fn) => setParamsState(fn),
      newOnly,
      setNewOnly,
      filterCount: filterCount(params, newOnly),
      clearFilters: () => {
        setParamsState((p) => ({ ...p, category: null, sources: [], brand: '', maxPrice: null }));
        setNewOnly(false);
      },
    }),
    [params, newOnly],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function filterCount(p: FeedParams, newOnly: boolean): number {
  return p.sources.length + (p.brand?.trim() ? 1 : 0) + (p.maxPrice != null ? 1 : 0) + (newOnly ? 1 : 0);
}

export function useFeedParams(): FeedState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useFeedParams outside FeedParamsProvider');
  return v;
}
