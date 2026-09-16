/** Ключ, под которым браузер помнит показанную редакцию документа cookies (cookies v2). */
export const storageNoticeKey = "inside.storage-notice.v1";

/** Уведомление видно при первом посещении и снова, когда выходит новая редакция документа. */
export function storageNoticeVisible(stored: string | null, edition: number): boolean {
  return stored !== String(edition);
}
