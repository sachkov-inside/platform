import type { PublishedMaterialProjectionDto } from "../../facets/published-material-reader/published-material.contract.js";
import type { ContentCoverProjection } from "../../facets/content-covers/content-covers.js";
import type { GuideIntroductionDto } from "../../facets/material-authoring/content-collection.contract.js";
import type { Result } from "../../result.js";

export type PublishedMaterialDiscoveryKind = "related" | "series" | "topic";

export interface DiscoverPublishedMaterialProjectionsQuery {
  readonly first: number | null;
  readonly kind: PublishedMaterialDiscoveryKind;
  readonly slug: string;
}

export interface PublishedMaterialDiscoveryPageDto {
  /** Chapters of a Guide's main path, in author order; empty for every other discovery kind. */
  readonly chapters: readonly {
    readonly id: string;
    readonly materialIds: readonly string[];
    readonly name: string;
    /** Авторское описание главы: на странице продукта оно объясняет, что внутри. */
    readonly summary: string;
  }[];
  readonly hasNext: boolean;
  readonly items: readonly PublishedMaterialProjectionDto[];
  readonly kind: PublishedMaterialDiscoveryKind;
  readonly reference: {
    readonly id: string;
    /** Author-written Guide introduction; null for every other discovery kind. */
    readonly introduction: GuideIntroductionDto | null;
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
