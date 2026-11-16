import { refreshAnnouncedQueries } from "@/shared/api/announced-query-refresh";
import type { QueryClient } from "@tanstack/react-query";

import { factAnnouncement } from "@/shared/api/fact-announcement";

/** Personal bookmarks announce writes only to readers of the same Account. */
export function bookmarkChanges(accountId: string) {
  return factAnnouncement(`inside.bookmarks.${accountId}.changed`);
}

export function refreshBookmarks(
  cache: QueryClient,
  accountId: string,
  announcementId: string,
): Promise<void> {
  return refreshAnnouncedQueries(
    cache,
    ["bookmarks", accountId],
    announcementId,
  );
}
