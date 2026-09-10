import type { BookmarkState } from "../domain/bookmark.js";

export function toBookmarkState(materialId: string, row: {
  readonly bookmarkedAt: Date;
} | null): BookmarkState {
  return row === null
    ? { materialId, bookmarked: false, bookmarkedAt: null }
    : {
        materialId,
        bookmarked: true,
        bookmarkedAt: row.bookmarkedAt.toISOString(),
      };
}
