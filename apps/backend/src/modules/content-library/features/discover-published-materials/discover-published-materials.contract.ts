import type { Subject } from "../../../content-access/index.js";
import type { PublishedMaterialCatalogItemDto } from "../list-published-materials/list-published-materials.contract.js";
import type {
  ContentCoverProjection,
  GuideIntroductionDto,
  GuideProductPageDto,
} from "../../../materials/index.js";

export interface DiscoverPublishedMaterialsQuery {
  readonly first: number | null;
  readonly kind: "related" | "series" | "topic";
  readonly slug: string;
  readonly subject: Subject;
}

export interface GuideChapterTaskDto {
  readonly code: string;
  readonly title: string;
  readonly access: "free" | "membership";
  readonly afterMaterialId: string | null;
  readonly availability: "available" | "locked" | "unavailable";
  /** The viewer's own latest submission; `null` for a guest. */
  readonly lastSubmittedAt: string | null;
}

export interface PublishedMaterialDiscoveryDto {
  /** Chapters of a Guide's main path, in author order; empty for every other discovery kind. */
  readonly chapters: readonly {
    readonly id: string;
    readonly materialIds: readonly string[];
    readonly name: string;
    /** Авторское описание главы: на странице продукта оно объясняет, что внутри. */
    readonly summary: string;
    /**
     * Published Guide Tasks of the chapter in author order (#947). Each stands after the Material
     * it names, or at the start of the chapter; the main path and its ordinals stay Materials only.
     */
    readonly tasks: readonly GuideChapterTaskDto[];
  }[];
  readonly hasNext: boolean;
  readonly items: readonly PublishedMaterialCatalogItemDto[];
  readonly kind: "related" | "series" | "topic";
  readonly reference: {
    /**
     * Whether any lesson of this Guide is written for both ways of going through it; false for
     * every other discovery kind.
     */
    readonly hasModeVariants: boolean;
    readonly id: string;
    /** Author-written Guide introduction; null for every other discovery kind. */
    readonly introduction: GuideIntroductionDto | null;
    readonly name: string;
    /** Product page presentation and description; null for every other discovery kind. */
    readonly productPage: GuideProductPageDto | null;
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
