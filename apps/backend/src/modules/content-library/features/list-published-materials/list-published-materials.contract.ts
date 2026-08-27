export interface PublishedMaterialCatalogItemDto {
  readonly materialId: string;
  readonly contentVersion: number;
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
  readonly items: readonly PublishedMaterialCatalogItemDto[];
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
