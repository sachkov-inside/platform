import { factAnnouncement } from "@/shared/api/fact-announcement";

/** A rating write reaches the other open tabs of the same Account. */
export function lessonRatingChanges(accountId: string) {
  return factAnnouncement(`inside.lesson-ratings.${accountId}.changed`);
}
