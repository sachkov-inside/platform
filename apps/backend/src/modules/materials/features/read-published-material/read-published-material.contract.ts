import type { VideoChapter } from "../../domain/video-chapters.js";
import type { RenderedMaterialBody } from "../../domain/material-body/material-body.js";
import type { Subject } from "../../../content-access/index.js";
import type { PublishedMaterialProjectionDto } from "../../facets/published-material-reader/published-material.contract.js";
import type { Result } from "../../result.js";
import type { VideoPresentation } from "../../../videos/index.js";

export interface LockedMaterialAccessDto {
  readonly availability: "locked";
  /** Продаётся ли подписка: ложь, когда в каталоге нет ни одного включённого в продажу варианта. */
  readonly subscriptionOffered: boolean;
}

export interface PublishedGlossaryTermDto {
  readonly id: string;
  readonly title: string;
  readonly englishTitle: string | null;
  readonly shortDefinition: string;
  readonly fullDefinition: string;
}

export type PublishedMaterialReadDto =
  | {
      readonly kind: "available";
      readonly cacheScope: "private-no-store" | "public";
      readonly projection: PublishedMaterialProjectionDto;
      readonly body: RenderedMaterialBody;
      /**
       * The Glossary Terms the body mentions or shows as cards, read from the Glossary with the
       * body, so a corrected definition needs no republication. A term the Glossary does not
       * hold is absent; the reader then shows its mention as plain text.
       */
      readonly glossaryTerms: readonly PublishedGlossaryTermDto[];
      /**
       * The deck «Термины урока»: the Glossary Terms this lesson introduces, in the order the body
       * first mentions them, then the rest by identifier. Empty when the lesson introduces none.
       */
      readonly lessonTerms: readonly PublishedGlossaryTermDto[];
      readonly primaryVideo: VideoPresentation | null;
      readonly videoChapters?: readonly VideoChapter[];
    }
  | {
      readonly kind: "teaser";
      readonly cacheScope: "private-no-store";
      readonly projection: PublishedMaterialProjectionDto;
      readonly access: LockedMaterialAccessDto;
    };

export type PublishedMaterialReadError =
  | { readonly code: "invalid_request_shape" }
  | { readonly code: "material_not_found" }
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "internal_error"; readonly correlationId: string };
export type PublishedMaterialReadResult = Result<
  PublishedMaterialReadDto,
  PublishedMaterialReadError
>;

export interface ReadPublishedMaterialQuery {
  readonly subject: Subject;
  readonly slug: string;
}

export type ReadPublishedMaterialOperation = (
  query: ReadPublishedMaterialQuery,
) => Promise<PublishedMaterialReadResult>;
