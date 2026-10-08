import type { QueryClient } from "@tanstack/react-query";

import { factAnnouncement } from "@/shared/api/fact-announcement";

/** Personal bookmarks announce writes only to readers of the same Account. */
export function bookmarkChanges(accountId: string) {
  return factAnnouncement(`inside.bookmarks.${accountId}.changed`);
}

interface BookmarkRefresh {
  readonly announcementId: string;
  readonly pending: Promise<void>;
}
const refreshes = new WeakMap<QueryClient, Map<string, BookmarkRefresh>>();

/** Cancel pre-write reads once per announcement; sibling consumers join the post-write read. */
export function refreshBookmarks(
  cache: QueryClient,
  accountId: string,
  announcementId: string,
): Promise<void> {
  let accounts = refreshes.get(cache);
  if (accounts === undefined) {
    accounts = new Map();
    refreshes.set(cache, accounts);
  }
  const previous = accounts.get(accountId);
  if (previous?.announcementId === announcementId) return previous.pending;
  const queryKey = ["bookmarks", accountId];
  const pending = cache
    .cancelQueries({ queryKey })
    .then(() =>
      cache.invalidateQueries({ queryKey }, { cancelRefetch: false }),
    );
  accounts.set(accountId, { announcementId, pending });
  return pending;
}
