import type { BookmarkState } from "../../domain/bookmark.js";

export type AddBookmarkError =
  | { readonly code: "invalid_request" }
  | { readonly code: "access_denied" }
  | { readonly code: "dependency_unavailable" };
export type AddBookmarkResult =
  | { readonly ok: true; readonly value: BookmarkState }
  | { readonly ok: false; readonly error: AddBookmarkError };

export interface AddBookmarkCommand {
  readonly accountId: string;
  readonly materialId: string;
}
