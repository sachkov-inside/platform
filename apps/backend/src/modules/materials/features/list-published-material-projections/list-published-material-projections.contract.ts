import type { PublishedMaterialProjectionDto } from "../../facets/published-material-reader/published-material.contract.js";
import type { Result } from "../../result.js";

export interface ListPublishedMaterialProjectionsQuery {
  readonly after?: PublishedMaterialProjectionCursor;
  readonly formatSlugs?: readonly string[];
  readonly first: number;
  readonly q?: string;
  readonly seriesSlugs?: readonly string[];
  readonly sort?: PublishedMaterialProjectionSort;
  readonly topicSlugs?: readonly string[];
}

export type PublishedMaterialProjectionSort =
  | "newest"
  | "relevance"
  | "series"
  | "title";

export type PublishedMaterialProjectionCursor =
  | {
      readonly kind: "newest";
      readonly materialId: string;
      readonly publishedAt: string;
    }
  | {
      readonly kind: "relevance";
      readonly materialId: string;
      readonly publishedAt: string;
      readonly rank: number;
    }
  | {
      readonly kind: "series";
      readonly materialId: string;
      readonly ordinal: number;
    }
  | {
      readonly kind: "title";
      readonly materialId: string;
      readonly title: string;
    };

export interface PublishedMaterialFacetOptionDto {
  readonly count: number;
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface PublishedMaterialProjectionPageDto {
  readonly continuation: PublishedMaterialProjectionCursor | null;
  readonly facets: {
    readonly formats: readonly PublishedMaterialFacetOptionDto[];
    readonly series: readonly PublishedMaterialFacetOptionDto[];
    readonly topics: readonly PublishedMaterialFacetOptionDto[];
  };
  readonly items: readonly PublishedMaterialProjectionDto[];
  readonly hasNext: boolean;
  readonly totalCount: number;
}

export type PublishedMaterialProjectionListError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "internal_error"; readonly correlationId: string };
export type PublishedMaterialProjectionListResult = Result<
  PublishedMaterialProjectionPageDto,
  PublishedMaterialProjectionListError
>;
export type ListPublishedMaterialProjectionsOperation = (
  query: ListPublishedMaterialProjectionsQuery,
) => Promise<PublishedMaterialProjectionListResult>;
