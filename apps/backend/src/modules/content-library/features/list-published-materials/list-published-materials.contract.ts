import type { Subject } from "../../../content-access/index.js";
import type { ContentCoverProjection } from "../../../materials/index.js";

export interface PublishedMaterialCatalogItemDto {
  readonly materialId: string;
  readonly contentVersion: number;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly access: "free" | "membership" | "workshop";
  readonly availability: "available" | "locked" | "unavailable";
  readonly publishedAt: string;
  readonly primaryVideoId: string | null;
  readonly primaryVideoDurationSeconds?: number;
  readonly cover: ContentCoverProjection | null;
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
  readonly facets: {
    readonly formats: readonly PublishedMaterialCatalogFacetDto[];
    readonly series: readonly PublishedMaterialCatalogFacetDto[];
    readonly topics: readonly PublishedMaterialCatalogFacetDto[];
  };
  readonly items: readonly PublishedMaterialCatalogItemDto[];
  readonly nextCursor: string | null;
  readonly totalCount: number;
}

export interface PublishedMaterialCatalogFacetDto {
  readonly count: number;
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly summary: string | null;
  readonly cover: ContentCoverProjection | null;
  readonly previewItems: readonly PublishedMaterialCatalogItemDto[];
}

export type PublishedMaterialCatalogError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "internal_error"; readonly correlationId: string };

export type PublishedMaterialCatalogResult =
  | { readonly ok: true; readonly value: PublishedMaterialCatalogPageDto }
  | { readonly ok: false; readonly error: PublishedMaterialCatalogError };

export interface ListPublishedMaterialsQuery {
  readonly subject: Subject;
  readonly after?: string;
  readonly canonicalTopicSlug?: string;
  readonly formatSlugs?: readonly string[];
  readonly first: number;
  readonly q?: string;
  readonly seriesSlugs?: readonly string[];
  readonly sort?: "newest" | "relevance" | "series" | "title";
  readonly topicSlugs?: readonly string[];
}
