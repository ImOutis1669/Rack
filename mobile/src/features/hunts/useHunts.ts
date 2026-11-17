import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/lib/auth';

/** All hunts; polls every 5 s while one is running, else every minute (as the web). */
export function useHunts() {
  const api = useSession().api();
  return useQuery({
    queryKey: ['hunts'],
    queryFn: api.hunts,
    refetchInterval: (q) => (q.state.data?.some((h) => h.run_requested_at) ? 5000 : 60_000),
  });
}
