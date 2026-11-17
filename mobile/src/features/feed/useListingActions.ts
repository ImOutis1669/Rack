import { nextVote, voteValue, type Vote } from '@rack/shared/vote';
import type { Listing } from '@rack/shared/types';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';

import { useToast } from '@/components/Toast';
import { useSession } from '@/lib/auth';

export interface ListingActions {
  vote: Vote;
  saved: boolean;
  castVote: (v: -1 | 1) => void;
  toggleSave: () => void;
  hide: (kind: 'seller' | 'brand', value: string) => void;
}

/** Optimistic vote / save / hide for one listing, with haptics (the web's useListingActions). */
export function useListingActions(item: Listing, onHidden?: (id: number) => void): ListingActions {
  const api = useSession().api();
  const toast = useToast();
  const [vote, setVote] = useState<Vote>(item.feedback);
  const [saved, setSaved] = useState(item.saved);

  const run = async (fn: () => Promise<unknown>, undo: () => void) => {
    try {
      await fn();
    } catch (e) {
      undo();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast(e instanceof Error ? e.message : "Couldn't save that");
    }
  };

  return {
    vote,
    saved,
    castVote: (v) => {
      const prev = vote;
      const next = nextVote(vote, v);
      setVote(next);
      void Haptics.selectionAsync();
      void run(() => api.feedback(item.id, voteValue(next)), () => setVote(prev));
    },
    toggleSave: () => {
      const prev = saved;
      setSaved(!saved);
      void Haptics.impactAsync(prev ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
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
