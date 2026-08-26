import type { PublishedMaterialProjectionDto } from "../../facets/published-material-reader/published-material.contract.js";
import type { Result } from "../../result.js";

export interface ListPublishedMaterialProjectionsQuery {
  readonly after?: {
    readonly materialId: string;
    readonly publishedAt: string;
  };
  readonly first: number;
}

export interface PublishedMaterialProjectionPageDto {
  readonly items: readonly PublishedMaterialProjectionDto[];
  readonly hasNext: boolean;
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
