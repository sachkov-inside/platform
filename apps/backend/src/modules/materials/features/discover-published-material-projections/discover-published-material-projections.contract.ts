import type { Subject } from "../../../content-access/index.js";
import type { PublishedMaterialProjectionDto } from "../../facets/published-material-reader/published-material.contract.js";
import type { ContentCoverProjection } from "../../../content-covers/index.js";
import type {
  ProductIntroductionDto,
  ProductLandingPageDto,
} from "../../facets/material-authoring/content-collection.contract.js";
import type { Result } from "../../result.js";

export type PublishedMaterialDiscoveryKind = "related" | "product" | "topic";

export interface DiscoverPublishedMaterialProjectionsQuery {
  readonly subject?: Subject;
  readonly first: number | null;
  readonly kind: PublishedMaterialDiscoveryKind;
  readonly slug: string;
}

export interface PublishedMaterialDiscoveryPageDto {
  readonly programmePlacements?: readonly {
    readonly id: string;
    readonly materialId: string;
    readonly chapterId: string | null;
    readonly stepGroup: string | null;
  }[];
  /** Product topics of a Product page in author order; absent for every other discovery kind. */
  readonly catalogueTopics?: readonly {
    readonly id: string;
    readonly name: string;
    readonly summary: string;
    /** Published catalogue Materials of the topic, in catalogue order. */
    readonly materialIds: readonly string[];
  }[];
  /**
   * Calendar date (YYYY-MM-DD) of the Product roadmap's last update, null without a roadmap;
   * absent for every other discovery kind.
   */
  readonly roadmapUpdatedOn?: string | null;
  /** Chapters of a Product's main path, in author order; empty for every other discovery kind. */
  readonly chapters: readonly {
    readonly id: string;
    readonly materialIds: readonly string[];
    readonly supplementaryMaterialIds?: readonly string[];
    readonly name: string;
    /** Авторское описание главы: на странице продукта оно объясняет, что внутри. */
    readonly summary: string;
    /** Roadmap status the author set for the chapter; null when the roadmap names none. */
    readonly roadmapStatus: "done" | "writing" | "planned" | null;
    /** Unpublished lessons of a `writing` chapter, in author order; empty otherwise. */
    readonly upcomingLessons: readonly {
      readonly title: string;
      readonly state: "writing" | "soon";
    }[];
  }[];
  readonly hasNext: boolean;
  readonly items: readonly PublishedMaterialProjectionDto[];
  readonly kind: PublishedMaterialDiscoveryKind;
  readonly reference: {
    readonly id: string;
    /** Author-written Product introduction; null for every other discovery kind. */
    readonly introduction: ProductIntroductionDto | null;
    readonly name: string;
    /** Product page presentation and description; null for every other discovery kind. */
    readonly productPage: ProductLandingPageDto | null;
    readonly slug: string;
    readonly summary: string;
    readonly cover: ContentCoverProjection | null;
  };
  readonly relatedProduct: readonly {
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
