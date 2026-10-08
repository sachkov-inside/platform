import type { QueryClient } from "@tanstack/react-query";
import type {
  accessSummaryQueryKey,
  invitationsQueryKey,
  peopleQueryKey,
} from "./access-query-keys";

type AccessQueryKey =
  | typeof accessSummaryQueryKey
  | typeof invitationsQueryKey
  | typeof peopleQueryKey;
interface AccessRefresh {
  readonly announcementId: string;
  readonly pending: Promise<void>;
}
const refreshes = new WeakMap<
  QueryClient,
  Map<AccessQueryKey[0], AccessRefresh>
>();

/** One post-write read per access surface and announcement, including the local writer. */
export function refreshAccessRead(
  cache: QueryClient,
  queryKey: AccessQueryKey,
  announcementId: string,
): Promise<void> {
  let surfaces = refreshes.get(cache);
  if (surfaces === undefined) {
    surfaces = new Map();
    refreshes.set(cache, surfaces);
  }
  const previous = surfaces.get(queryKey[0]);
  if (previous?.announcementId === announcementId) return previous.pending;
  const pending = cache
    .cancelQueries({ queryKey })
    .then(() =>
      cache.invalidateQueries({ queryKey }, { cancelRefetch: false }),
    );
  surfaces.set(queryKey[0], { announcementId, pending });
  return pending;
}
