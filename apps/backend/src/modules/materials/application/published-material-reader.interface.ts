import type { MaterialAccess } from "../domain/material-revision-metadata.js";
import type { RenderedMaterialBody } from "../domain/material-body/material-body.js";
import type { AccessDecision, Subject } from "./ports/content-access.js";

export interface PublicMaterialProjectionDto {
  readonly materialId: string;
  readonly revisionId: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly access: MaterialAccess;
  readonly topicId: string;
  readonly formatId: string;
  readonly tagIds: readonly string[];
  readonly seriesMemberships: readonly {
    readonly seriesId: string;
    readonly ordinal: number;
  }[];
}

export type PublishedMaterialReadDto =
  | {
      readonly kind: "available";
      readonly cacheScope: "private-no-store" | "public";
      readonly projection: PublicMaterialProjectionDto;
      readonly body: RenderedMaterialBody;
    }
  | {
      readonly kind: "teaser";
      readonly cacheScope: "private-no-store" | "public";
      readonly projection: PublicMaterialProjectionDto;
      readonly access: Extract<AccessDecision, { readonly allowed: false }>;
    };

export type PublishedMaterialReadResult =
  | { readonly ok: true; readonly value: PublishedMaterialReadDto }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "material_not_found" }
        | { readonly code: "dependency_unavailable"; readonly retryable: true }
        | { readonly code: "internal_error"; readonly correlationId: string };
    };

export interface PublishedMaterialReader {
  read(query: {
    readonly subject: Subject;
    readonly slug: string;
  }): Promise<PublishedMaterialReadResult>;
}

export const PUBLISHED_MATERIAL_READER = Symbol("PUBLISHED_MATERIAL_READER");
