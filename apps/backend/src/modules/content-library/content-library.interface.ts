import type { PublishedMaterialProjectionDto } from "../materials/index.js";

export type { PublishedMaterialProjectionDto } from "../materials/index.js";

export interface PublishedMaterialCatalogPageDto {
  readonly items: readonly PublishedMaterialProjectionDto[];
  readonly nextCursor: string | null;
}

export type PublishedMaterialCatalogError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "internal_error"; readonly correlationId: string };

export type PublishedMaterialCatalogResult =
  | { readonly ok: true; readonly value: PublishedMaterialCatalogPageDto }
  | { readonly ok: false; readonly error: PublishedMaterialCatalogError };

export interface ListPublishedMaterialsQuery {
  readonly after?: string;
  readonly first: number;
}

export interface ContentLibrary {
  readonly listPublishedMaterials: (
    query: ListPublishedMaterialsQuery,
  ) => Promise<PublishedMaterialCatalogResult>;
}

export const CONTENT_LIBRARY = Symbol("CONTENT_LIBRARY");
