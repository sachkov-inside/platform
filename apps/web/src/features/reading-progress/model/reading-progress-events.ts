import { factAnnouncement } from "@/shared/api/fact-announcement";
import type { QueryClient } from "@tanstack/react-query";

/** Прогресс изменяет и личные отметки, и серверное продолжение курса. */
export function readingProgressChanges(accountId: string) {
  return factAnnouncement(`inside.reading-progress.${accountId}.changed`);
}

const refreshes = new WeakMap<
  QueryClient,
  Map<string, { readonly id: string; readonly pending: Promise<void> }>
>();

/** Подписчики одной записи присоединяются к одному перечитыванию. */
export function refreshReadingProgress(
  cache: QueryClient,
  accountId: string,
  id: string,
): Promise<void> {
  let accounts = refreshes.get(cache);
  if (accounts === undefined) {
    accounts = new Map();
    refreshes.set(cache, accounts);
  }
  const previous = accounts.get(accountId);
  if (previous?.id === id) return previous.pending;
  const queryKey = ["reading-progress", accountId];
  const pending = cache
    .cancelQueries({ queryKey })
    .then(() =>
      cache.invalidateQueries({ queryKey }, { cancelRefetch: false }),
    );
  accounts.set(accountId, { id, pending });
  return pending;
}
