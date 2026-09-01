import type {
  MaterialAccess,
  MaterialMetadataValidationError,
} from "../../domain/material-metadata.js";
import type { PublicationState } from "../../domain/material.js";
import type {
  MaterialBodySnapshot,
  ValidationIssue,
} from "../../domain/material-body/material-body.js";

export interface SeriesMembershipInput {
  readonly seriesId: string;
  readonly ordinal: number;
}

export interface MaterialMetadataSelectionInput {
  readonly title: string | null;
  readonly summary: string | null;
  readonly access: MaterialAccess;
  readonly topicId: string | null;
  readonly formatId: string | null;
  readonly tagIds: readonly string[];
  readonly seriesIds: readonly string[];
}

export interface MaterialMetadataDto
  extends Omit<MaterialMetadataSelectionInput, "seriesIds"> {
  readonly slug: string | null;
  readonly seriesMemberships: readonly SeriesMembershipInput[];
}

export interface MaterialDto {
  readonly materialId: string;
  readonly contentVersion: number;
  readonly publicationState: PublicationState;
  readonly firstPublishedAt: string | null;
  readonly publishedAt: string | null;
  readonly metadata: MaterialMetadataDto;
  readonly body: MaterialBodySnapshot;
}

export interface MaterialMutationReceiptDto {
  readonly materialId: string;
  readonly contentVersion: number;
  readonly publicationState: PublicationState;
  readonly publishedAt: string | null;
}

export type InvalidContentError = Extract<
  MaterialMetadataValidationError,
  { readonly code: "invalid_content" }
>;
export type DuplicateTagError = Extract<
  MaterialMetadataValidationError,
  { readonly code: "duplicate_tag" }
>;
export type InvalidReferenceError = {
  readonly code: "invalid_reference";
  readonly issues: readonly ValidationIssue[];
};
export type SeriesOrdinalConflictError = {
  readonly code: "series_ordinal_conflict";
  readonly seriesId: string;
  readonly ordinal: number;
};
export type SystemError =
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "internal_error"; readonly correlationId: string };
export type IdempotencyError = { readonly code: "idempotency_key_reused" };
export type ForbiddenError = { readonly code: "forbidden" };
export type MaterialNotFoundError = { readonly code: "material_not_found" };
export type StaleContentVersionError = {
  readonly code: "stale_content_version";
  readonly currentContentVersion: number;
};
export type InvalidPublicationTransitionError = {
  readonly code: "invalid_publication_transition";
  readonly currentState: PublicationState;
  readonly targetState: PublicationState;
};
export type DraftDeletionForbiddenError = {
  readonly code: "draft_deletion_forbidden";
};
export type ContentCollectionNotFoundError = {
  readonly code: "content_collection_not_found";
};
export type ContentCollectionSlugConflictError = {
  readonly code: "content_collection_slug_conflict";
};
export type StaleContentCollectionVersionError = {
  readonly code: "stale_content_collection_version";
  readonly currentVersion: number;
};
