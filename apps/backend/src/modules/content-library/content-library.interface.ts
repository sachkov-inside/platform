export interface PublishedMaterialProjectionDto {
  readonly materialId: string;
  readonly revisionId: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly access: "free" | "membership";
  readonly publishedAt: string;
  readonly topic: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
  readonly format: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
  readonly tags: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly seriesMemberships: readonly {
    readonly ordinal: number;
    readonly series: {
      readonly id: string;
      readonly name: string;
      readonly slug: string;
    };
  }[];
}

export interface PublishedMaterialCatalogPageDto {
  readonly items: readonly PublishedMaterialProjectionDto[];
  readonly nextCursor: string | null;
}

export type ContentLibrarySystemError =
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "internal_error"; readonly correlationId: string };

export type PublishedMaterialCatalogError =
  | { readonly code: "invalid_request_shape" }
  | ContentLibrarySystemError;

export type PublishedMaterialCatalogResult =
  | { readonly ok: true; readonly value: PublishedMaterialCatalogPageDto }
  | { readonly ok: false; readonly error: PublishedMaterialCatalogError };

export type PublishedMaterialLookupError =
  | { readonly code: "invalid_request_shape" }
  | ContentLibrarySystemError;

export type PublishedMaterialLookupResult =
  | { readonly ok: true; readonly value: PublishedMaterialProjectionDto | undefined }
  | { readonly ok: false; readonly error: PublishedMaterialLookupError };

export interface ListPublishedMaterialsQuery {
  readonly after?: string;
  readonly first: number;
}

export interface ContentLibrary {
  readonly findPublishedMaterial: (
    slug: string,
  ) => Promise<PublishedMaterialLookupResult>;
  readonly listPublishedMaterials: (
    query: ListPublishedMaterialsQuery,
  ) => Promise<PublishedMaterialCatalogResult>;
}

export const CONTENT_LIBRARY = Symbol("CONTENT_LIBRARY");
