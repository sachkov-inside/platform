import {
  hashKey,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

const refreshes = new WeakMap<
  QueryClient,
  Map<string, { readonly id: string; readonly pending: Promise<void> }>
>();

/**
 * Re-reads the queries under `queryKey` once per announced write: a read started before the write
 * is cancelled, and every surface of this document that heard the same announcement joins the one
 * read after it.
 */
export function refreshAnnouncedQueries(
  cache: QueryClient,
  queryKey: QueryKey,
  announcementId: string,
): Promise<void> {
  let byKey = refreshes.get(cache);
  if (byKey === undefined) {
    byKey = new Map();
    refreshes.set(cache, byKey);
  }
  const scope = hashKey(queryKey);
  const previous = byKey.get(scope);
  if (previous?.id === announcementId) return previous.pending;
  const pending = cache
    .cancelQueries({ queryKey })
    .then(() =>
      cache.invalidateQueries({ queryKey }, { cancelRefetch: false }),
    );
  byKey.set(scope, { id: announcementId, pending });
  return pending;
}
