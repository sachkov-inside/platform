import type { PublishedMaterialProjectionDto } from "../../facets/published-material-reader/published-material.contract.js";
import type { ContentCoverProjection } from "../../facets/content-covers/content-covers.js";
import type { Result } from "../../result.js";

export type PublishedMaterialDiscoveryKind = "related" | "series" | "topic";

export interface DiscoverPublishedMaterialProjectionsQuery {
  readonly first: number | null;
  readonly kind: PublishedMaterialDiscoveryKind;
  readonly slug: string;
}

export interface PublishedMaterialDiscoveryPageDto {
  readonly hasNext: boolean;
  readonly items: readonly PublishedMaterialProjectionDto[];
  readonly kind: PublishedMaterialDiscoveryKind;
  readonly reference: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly summary: string;
    readonly cover: ContentCoverProjection | null;
  };
  readonly relatedSeries: readonly {
    readonly id: string;
    readonly matchingMaterialCount: number;
    readonly name: string;
    readonly slug: string;
    readonly summary: string;
    readonly totalMaterialCount: number;
    readonly cover: ContentCoverProjection | null;
  }[];
  readonly topics: readonly {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly cover: ContentCoverProjection | null;
  }[];
}

export type PublishedMaterialDiscoveryError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "discovery_not_found" }
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "internal_error"; readonly correlationId: string };

export type PublishedMaterialDiscoveryResult = Result<
  PublishedMaterialDiscoveryPageDto,
  PublishedMaterialDiscoveryError
>;

export type DiscoverPublishedMaterialProjectionsOperation = (
  query: DiscoverPublishedMaterialProjectionsQuery,
) => Promise<PublishedMaterialDiscoveryResult>;
