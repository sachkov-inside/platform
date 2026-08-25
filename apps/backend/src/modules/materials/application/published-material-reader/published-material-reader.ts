import type { RenderedMaterialBody } from "../../domain/material-body/material-body.js";
import type { Result } from "../../result.js";
import type { AccessDecision, Subject } from "../ports/content-access.js";

export interface PublishedMaterialProjectionDto {
  readonly materialId: string;
  readonly revisionId: string;
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly access: "free" | "membership";
  readonly publishedAt: string;
  readonly topic: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
  readonly format: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
  readonly tags: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly seriesMemberships: readonly {
    readonly ordinal: number;
    readonly series: {
      readonly id: string;
      readonly name: string;
      readonly slug: string;
    };
  }[];
}

export type PublishedMaterialReadDto =
  | {
      readonly kind: "available";
      readonly cacheScope: "private-no-store" | "public";
      readonly projection: PublishedMaterialProjectionDto;
      readonly body: RenderedMaterialBody;
    }
  | {
      readonly kind: "teaser";
      readonly cacheScope: "private-no-store" | "public";
      readonly projection: PublishedMaterialProjectionDto;
      readonly access: Extract<AccessDecision, { readonly allowed: false }>;
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

export interface PublishedMaterialReader {
  readonly listProjections: ListPublishedMaterialProjectionsOperation;
  readonly read: ReadPublishedMaterialOperation;
}

export const PUBLISHED_MATERIAL_READER = Symbol("PUBLISHED_MATERIAL_READER");
