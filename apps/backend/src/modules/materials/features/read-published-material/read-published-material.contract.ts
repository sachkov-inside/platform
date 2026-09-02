import type { RenderedMaterialBody } from "../../domain/material-body/material-body.js";
import type { Subject } from "../../../content-access/index.js";
import type { PublishedMaterialProjectionDto } from "../../facets/published-material-reader/published-material.contract.js";
import type { Result } from "../../result.js";
import type { VideoPresentation } from "../../../videos/index.js";

export interface LockedMaterialAccessDto {
  readonly availability: "locked";
  readonly cta: {
    readonly label: "Получить доступ";
    readonly url: string;
  };
}

export type PublishedMaterialReadDto =
  | {
      readonly kind: "available";
      readonly cacheScope: "private-no-store" | "public";
      readonly projection: PublishedMaterialProjectionDto;
      readonly body: RenderedMaterialBody;
      readonly primaryVideo: VideoPresentation | null;
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
