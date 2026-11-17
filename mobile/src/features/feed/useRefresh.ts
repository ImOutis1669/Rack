import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useToast } from '@/components/Toast';
import { useSession } from '@/lib/auth';

/**
 * Pull to refresh (the web's Refresh button): re-ranks the feed now and asks the worker to search
 * the sources, which the server allows once per cooldown (its message says when). When a search
 * finishes, the feed reloads now and again a minute later, once new items are scored.
 */
export function useRefresh() {
  const api = useSession().api();
  const qc = useQueryClient();
  const toast = useToast();
  const status = useQuery({
    queryKey: ['refresh'],
    queryFn: api.refreshStatus,
    refetchInterval: (q) => (q.state.data?.running || q.state.data?.queued ? 4000 : false),
  });
  const busy = Boolean(status.data?.running || status.data?.queued);

  const reloadFeed = () => {
    void qc.invalidateQueries({ queryKey: ['feed'] });
    void qc.invalidateQueries({ queryKey: ['health'] });
  };

  const request = useMutation({
    mutationFn: api.refresh,
    onMutate: reloadFeed,
    onSuccess: (s) => {
      qc.setQueryData(['refresh'], s);
      toast(s.message);
    },
    onError: (e) => toast(e instanceof Error ? e.message : "Couldn't refresh"),
  });

  const lastAt = useRef(status.data?.last_at);
  useEffect(() => {
    const now = status.data?.last_at;
    if (now && lastAt.current && now !== lastAt.current) {
      const total = Object.values(status.data?.results ?? {}).reduce((a, b) => a + b, 0);
      toast({ text: `Checked ${total} listings. New ones appear as they're scored.`, ms: 6000 });
      reloadFeed();
      const t = setTimeout(reloadFeed, 60_000);
      lastAt.current = now;
      return () => clearTimeout(t);
    }
    lastAt.current = now;
  }, [status.data?.last_at]); // eslint-disable-line react-hooks/exhaustive-deps

  return { refresh: () => request.mutateAsync().catch(() => undefined), refreshing: request.isPending, busy };
}
