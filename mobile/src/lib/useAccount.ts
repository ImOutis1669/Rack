import { useQuery } from '@tanstack/react-query';

import { useSession } from '@/lib/auth';

/** Your account (photo, name, role): the header avatar and the Profile sheet. */
export function useAccount() {
  const session = useSession();
  return useQuery({ queryKey: ['account'], queryFn: () => session.api().account(), staleTime: 5 * 60_000 });
}
