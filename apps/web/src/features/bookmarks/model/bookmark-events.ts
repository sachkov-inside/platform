import { factAnnouncement } from "@/shared/api/fact-announcement";

/** Personal bookmarks announce writes only to readers of the same Account. */
export function bookmarkChanges(accountId: string) {
  return factAnnouncement(`inside.bookmarks.${accountId}.changed`);
}
