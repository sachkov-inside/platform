import type {
  MaterialBodyChange,
  MaterialBodySnapshot,
  MaterialBodyExtraction,
  RenderedMaterialBody,
  ValidationIssue,
} from "../domain/material-body/material-body.js";
import type {
  MaterialAccess,
  MaterialMetadataValidationError,
} from "../domain/material-revision-metadata.js";
import type { Result } from "../result.js";

export type { Result } from "../result.js";

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

export interface CreateDraftCommand {
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly metadata: MaterialRevisionMetadataInput;
  readonly body: unknown;
}

export interface LoadDraftQuery {
  readonly actor: string;
  readonly materialId: string;
}

export interface ReviseDraftCommand {
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly materialId: string;
  readonly baseRevisionId: string;
  readonly changes: {
    readonly metadata?: MaterialRevisionMetadataChanges;
    readonly body?: readonly MaterialBodyChange[];
  };
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

export type CreateDraftError =
  | MaterialMetadataValidationError
  | ForbiddenError
  | InvalidReferenceError
  | PersistenceConflictError
  | IdempotencyError
  | SystemError;
export type LoadDraftError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | SystemError;
export type ReviseDraftError =
  | MaterialMetadataValidationError
  | ForbiddenError
  | MaterialNotFoundError
  | StaleRevisionError
  | InvalidReferenceError
  | PersistenceConflictError
  | IdempotencyError
  | SystemError;

export type CreateDraftResult = Result<MaterialRevisionDto, CreateDraftError>;
export type LoadDraftResult = Result<MaterialRevisionDto, LoadDraftError>;
export type ReviseDraftResult = Result<MaterialRevisionDto, ReviseDraftError>;

export interface ValidateRevisionQuery {
  readonly actor: string;
  readonly materialId: string;
  readonly revisionId: string;
}

export interface ValidatedRevisionDto {
  readonly materialId: string;
  readonly revisionId: string;
  readonly projectionDigest: string;
  readonly extraction: MaterialBodyExtraction;
}

export interface PreviewRevisionDto {
  readonly materialId: string;
  readonly revisionId: string;
  readonly metadata: MaterialRevisionMetadataDto;
  readonly cacheScope: "private-no-store";
  readonly body: RenderedMaterialBody;
}

export interface PublishRevisionCommand {
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly materialId: string;
  readonly revisionId: string;
  readonly expectedPublishedRevisionId: string | null;
}

export interface RestoreRevisionCommand {
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly materialId: string;
  readonly revisionId: string;
  readonly baseRevisionId: string;
}

export interface UnpublishMaterialCommand {
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly materialId: string;
  readonly expectedPublishedRevisionId: string;
}

export interface PublicationLifecycleEventDto {
  readonly materialId: string;
  readonly revisionId: string;
  readonly publicationEventId: string;
  readonly recordedAt: Date;
}

export type ValidateRevisionError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | RevisionNotFoundError
  | StaleRevisionError
  | InvalidReferenceError
  | SeriesOrdinalConflictError
  | SystemError;
export type PreviewRevisionError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | RevisionNotFoundError
  | SystemError;
export type PublishRevisionError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | RevisionNotFoundError
  | StaleRevisionError
  | StalePublicationError
  | InvalidReferenceError
  | PersistenceConflictError
  | IdempotencyError
  | SystemError;
export type RestoreRevisionError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | RevisionNotFoundError
  | StaleRevisionError
  | InvalidReferenceError
  | PersistenceConflictError
  | IdempotencyError
  | SystemError;
export type UnpublishMaterialError =
  | InvalidContentError
  | ForbiddenError
  | MaterialNotFoundError
  | StalePublicationError
  | { readonly code: "publication_not_found" }
  | IdempotencyError
  | SystemError;

export type ValidateRevisionResult = Result<
  ValidatedRevisionDto,
  ValidateRevisionError
>;
export type PreviewRevisionResult = Result<PreviewRevisionDto, PreviewRevisionError>;
export type PublishRevisionResult = Result<
  PublicationLifecycleEventDto,
  PublishRevisionError
>;
export type RestoreRevisionResult = Result<MaterialRevisionDto, RestoreRevisionError>;
export type UnpublishMaterialResult = Result<
  PublicationLifecycleEventDto,
  UnpublishMaterialError
>;

export type CreateDraftOperation = (
  command: CreateDraftCommand,
) => Promise<CreateDraftResult>;
export type LoadDraftOperation = (
  query: LoadDraftQuery,
) => Promise<LoadDraftResult>;
export type ReviseDraftOperation = (
  command: ReviseDraftCommand,
) => Promise<ReviseDraftResult>;
export type ValidateRevisionOperation = (
  query: ValidateRevisionQuery,
) => Promise<ValidateRevisionResult>;
export type PreviewRevisionOperation = (
  query: ValidateRevisionQuery,
) => Promise<PreviewRevisionResult>;
export type PublishRevisionOperation = (
  command: PublishRevisionCommand,
) => Promise<PublishRevisionResult>;
export type RestoreRevisionOperation = (
  command: RestoreRevisionCommand,
) => Promise<RestoreRevisionResult>;
export type UnpublishMaterialOperation = (
  command: UnpublishMaterialCommand,
) => Promise<UnpublishMaterialResult>;

export interface MaterialAuthoring {
  readonly createDraft: CreateDraftOperation;
  readonly loadDraft: LoadDraftOperation;
  readonly reviseDraft: ReviseDraftOperation;
  readonly validateRevision: ValidateRevisionOperation;
  readonly previewRevision: PreviewRevisionOperation;
  readonly publishRevision: PublishRevisionOperation;
  readonly restoreRevision: RestoreRevisionOperation;
  readonly unpublishMaterial: UnpublishMaterialOperation;
}

export const MATERIAL_AUTHORING = Symbol("MATERIAL_AUTHORING");
