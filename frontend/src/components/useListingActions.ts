import { useState } from "react";
import { api } from "../api/client";
import type { Listing } from "../api/types";

export interface ListingActions {
  vote: -1 | 1 | null;
  saved: boolean;
  error: string | null;
  castVote: (v: -1 | 1) => void;
  toggleSave: () => void;
  hide: (kind: "seller" | "brand", value: string) => void;
}

/** Optimistic 👍/👎, save and hide for one listing (shared by the tile and the detail sheet). */
export function useListingActions(item: Listing, onHidden?: (id: number) => void): ListingActions {
  const [vote, setVote] = useState<-1 | 1 | null>(item.feedback);
  const [saved, setSaved] = useState(item.saved);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, undo: () => void) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      undo();
      setError(String((e as Error).message));
    }
  };

  return {
    vote,
    saved,
    error,
    castVote: (v) => {
      const prev = vote;
      const next = vote === v ? null : v;
      setVote(next);
      void run(() => api.feedback(item.id, next ?? 0), () => setVote(prev));
    },
    toggleSave: () => {
      const prev = saved;
      setSaved(!saved);
      void run(() => (prev ? api.unsave(item.id) : api.save(item.id)), () => setSaved(prev));
    },
    hide: (kind, value) => {
      void run(
        async () => {
          await api.hide(kind, value);
          onHidden?.(item.id);
        },
        () => undefined,
      );
    },
  };
}
