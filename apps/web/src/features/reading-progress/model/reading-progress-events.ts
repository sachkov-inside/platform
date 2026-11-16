import { refreshAnnouncedQueries } from "@/shared/api/announced-query-refresh";
import { factAnnouncement } from "@/shared/api/fact-announcement";
import type { QueryClient } from "@tanstack/react-query";

/** Прогресс изменяет и личные отметки, и серверное продолжение курса. */
export function readingProgressChanges(accountId: string) {
  return factAnnouncement(`inside.reading-progress.${accountId}.changed`);
}

/**
 * Opened parts of a step-by-step lesson travel with its reading state, but have their own channel:
 * a part opens often, and the reading progress channel re-renders whole pages.
 */
export function lessonOpenedPartsChanges(accountId: string) {
  return factAnnouncement(`inside.lesson-opened-parts.${accountId}.changed`);
}

export function refreshReadingProgress(
  cache: QueryClient,
  accountId: string,
  id: string,
): Promise<void> {
  return refreshAnnouncedQueries(cache, ["reading-progress", accountId], id);
}
