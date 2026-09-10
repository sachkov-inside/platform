import type { BookmarkState } from "../../domain/bookmark.js";

export type RemoveBookmarkError =
  | { readonly code: "invalid_request" }
  | { readonly code: "dependency_unavailable" };
export type RemoveBookmarkResult =
  | { readonly ok: true; readonly value: BookmarkState }
  | { readonly ok: false; readonly error: RemoveBookmarkError };

export interface RemoveBookmarkCommand {
  readonly accountId: string;
  readonly materialId: string;
}
