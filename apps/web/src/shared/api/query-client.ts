import {
  environmentManager,
  QueryClient,
} from "@tanstack/react-query";

const QUERY_STALE_TIME_MS = 30_000;
const QUERY_GARBAGE_COLLECTION_TIME_MS = 30 * 60_000;

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: QUERY_GARBAGE_COLLECTION_TIME_MS,
        staleTime: QUERY_STALE_TIME_MS,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/** Isolates server request caches while preserving one browser cache across renders. */
export function getQueryClient(): QueryClient {
  if (environmentManager.isServer()) {
    return createQueryClient();
  }

  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
}
