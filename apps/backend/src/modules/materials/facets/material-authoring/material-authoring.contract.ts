import type { MaterialBodySnapshot, ValidationIssue } from "../../domain/material-body/material-body.js";
import type {
  MaterialAccess,
  MaterialMetadataValidationError,
} from "../../domain/material-revision-metadata.js";

export interface SeriesMembershipInput {
  readonly seriesId: string;
  readonly ordinal: number;
}

export interface MaterialRevisionMetadataInput {
  readonly title: string;
  readonly summary: string;
  readonly slug: string;
  readonly access: MaterialAccess;
  readonly topicId: string;
  readonly formatId: string;
  readonly tagIds: readonly string[];
  readonly seriesMemberships: readonly SeriesMembershipInput[];
}

export interface MaterialRevisionMetadataChanges {
  readonly title?: string;
  readonly summary?: string;
  readonly slug?: string;
  readonly access?: MaterialAccess;
  readonly topicId?: string;
  readonly formatId?: string;
  readonly tagIds?: readonly string[];
  readonly seriesMemberships?: readonly SeriesMembershipInput[];
}

export type MaterialRevisionMetadataDto = MaterialRevisionMetadataInput;

export interface MaterialRevisionDto {
  readonly materialId: string;
  readonly revisionId: string;
  readonly metadata: MaterialRevisionMetadataDto;
  readonly body: MaterialBodySnapshot;
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
export type SlugConflictError = {
  readonly code: "slug_conflict";
  readonly slug: string;
};
export type SeriesOrdinalConflictError = {
  readonly code: "series_ordinal_conflict";
  readonly seriesId: string;
  readonly ordinal: number;
};
export type PersistenceConflictError =
  | SeriesOrdinalConflictError
  | SlugConflictError;
export type SystemError =
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "internal_error"; readonly correlationId: string };
export type IdempotencyError = { readonly code: "idempotency_key_reused" };
export type ForbiddenError = { readonly code: "forbidden" };
export type MaterialNotFoundError = { readonly code: "material_not_found" };
export type RevisionNotFoundError = { readonly code: "revision_not_found" };
export type StaleRevisionError = {
  readonly code: "stale_revision";
  readonly currentRevisionId: string;
};
export type StalePublicationError = {
  readonly code: "stale_publication";
  readonly currentPublishedRevisionId: string | null;
};

export interface PublicationLifecycleEventDto {
  readonly materialId: string;
  readonly revisionId: string;
  readonly publicationEventId: string;
  readonly recordedAt: Date;
}
