import type { Listing } from '@rack/shared/types';
import { nextVote, voteValue, type Vote } from '@rack/shared/vote';
import * as Haptics from 'expo-haptics';

import { useToast } from '@/components/Toast';
import { useSession } from '@/lib/auth';
import { setListingState, useListingState } from '@/lib/listingState';

export interface ListingActions {
  vote: Vote;
  saved: boolean;
  castVote: (v: -1 | 1) => void;
  toggleSave: () => void;
  /** Hide this seller or brand everywhere; the listing leaves the feed at once. */
  hide: (kind: 'seller' | 'brand', value: string) => Promise<boolean>;
}

/**
 * Optimistic vote / save / hide for one listing, with haptics (the web's useListingActions).
 * State lives in lib/listingState, so the tile and the listing sheet always agree.
 */
export function useListingActions(item: Listing): ListingActions {
  const api = useSession().api();
  const toast = useToast();
  const { vote, saved } = useListingState(item);

  const run = async (fn: () => Promise<unknown>, undo: () => void): Promise<boolean> => {
    try {
      await fn();
      return true;
    } catch (e) {
      undo();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast(e instanceof Error ? e.message : "Couldn't save that");
      return false;
    }
  };

  return {
    vote,
    saved,
    castVote: (v) => {
      const prev = vote;
      const next = nextVote(vote, v);
      setListingState(item.id, { vote: next });
      void Haptics.selectionAsync();
      void run(() => api.feedback(item.id, voteValue(next)), () => setListingState(item.id, { vote: prev }));
    },
    toggleSave: () => {
      const prev = saved;
      setListingState(item.id, { saved: !prev });
      void Haptics.impactAsync(prev ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
      void run(() => (prev ? api.unsave(item.id) : api.save(item.id)), () => setListingState(item.id, { saved: prev }));
    },
    hide: (kind, value) =>
      run(async () => {
        await api.hide(kind, value);
        setListingState(item.id, { hidden: true });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toast(kind === 'seller' ? `Hid seller ${value}` : `Hid ${value}`);
      }, () => undefined),
  };
}
