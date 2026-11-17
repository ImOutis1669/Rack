import { UnauthorizedError } from '@rack/shared/client';
import { QueryClient } from '@tanstack/react-query';

/** Same policy as the web (frontend/src/main.tsx): never retry a signed-out request. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, err) => !(err instanceof UnauthorizedError) && count < 2,
        staleTime: 30_000,
      },
    },
  });
}
