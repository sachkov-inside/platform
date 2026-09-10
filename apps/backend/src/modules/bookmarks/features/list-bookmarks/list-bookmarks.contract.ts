import type { PublishedMaterialCatalogItemDto } from "../../../content-library/index.js";

export interface BookmarkListPageDto {
  readonly items: readonly PublishedMaterialCatalogItemDto[];
  readonly nextCursor: string | null;
}

export type ListBookmarksError =
  | { readonly code: "invalid_request" }
  | { readonly code: "dependency_unavailable" };
export type ListBookmarksResult =
  | { readonly ok: true; readonly value: BookmarkListPageDto }
  | { readonly ok: false; readonly error: ListBookmarksError };

export interface ListBookmarksQuery {
  readonly accountId: string;
  readonly after?: string;
  readonly first: number;
}
