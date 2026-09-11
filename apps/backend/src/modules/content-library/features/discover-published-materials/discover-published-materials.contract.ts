import type { Subject } from "../../../content-access/index.js";
import type { PublishedMaterialCatalogItemDto } from "../list-published-materials/list-published-materials.contract.js";
import type {
  ContentCoverProjection,
  GuideIntroductionDto,
} from "../../../materials/index.js";

export interface DiscoverPublishedMaterialsQuery {
  readonly first: number | null;
  readonly kind: "related" | "series" | "topic";
  readonly slug: string;
  readonly subject: Subject;
}

export interface PublishedMaterialDiscoveryDto {
  /** Chapters of a Guide's main path, in author order; empty for every other discovery kind. */
  readonly chapters: readonly {
    readonly id: string;
    readonly materialIds: readonly string[];
    readonly name: string;
    /** Авторское описание главы: на странице продукта оно объясняет, что внутри. */
    readonly summary: string;
  }[];
  readonly hasNext: boolean;
  readonly items: readonly PublishedMaterialCatalogItemDto[];
  readonly kind: "related" | "series" | "topic";
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

export type PublishedMaterialDiscoveryResult =
  | { readonly ok: true; readonly value: PublishedMaterialDiscoveryDto }
  | { readonly ok: false; readonly error: PublishedMaterialDiscoveryError };
