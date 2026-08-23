import type {
  MaterialBodyChange,
  MaterialBodySnapshot,
  MaterialBodyExtraction,
  RenderedMaterialBody,
  ValidationIssue,
} from "../domain/material-body/material-body.js";
import type {
  MaterialAccess,
  MaterialRevisionMetadataValidationError,
} from "../domain/material-revision-metadata.js";

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
  MaterialRevisionMetadataValidationError,
  { readonly code: "invalid_content" }
>;
export type InvalidReferenceError = {
  readonly code: "invalid_reference";
  readonly issues: readonly ValidationIssue[];
};
export type PersistenceConflictError =
  | Extract<MaterialRevisionMetadataValidationError, { readonly code: "duplicate_tag" }>
  | { readonly code: "slug_conflict"; readonly slug: string }
  | {
      readonly code: "series_ordinal_conflict";
      readonly seriesId: string;
      readonly ordinal: number;
    };
export type SystemError =
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "internal_error"; readonly correlationId: string };
export type PostgresOperationError =
  | InvalidReferenceError
  | PersistenceConflictError
  | SystemError;
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

export type Result<Value, Error> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: Error };

export type ResultError<ResultType> = ResultType extends {
  readonly ok: false;
  readonly error: infer Error;
}
  ? Error
  : never;

export type CreateDraftError =
  | MaterialRevisionMetadataValidationError
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
  | MaterialRevisionMetadataValidationError
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

export interface MaterialAuthoring {
  createDraft(command: CreateDraftCommand): Promise<CreateDraftResult>;
  loadDraft(query: LoadDraftQuery): Promise<LoadDraftResult>;
  reviseDraft(command: ReviseDraftCommand): Promise<ReviseDraftResult>;
  validateRevision(query: ValidateRevisionQuery): Promise<ValidateRevisionResult>;
  previewRevision(query: ValidateRevisionQuery): Promise<PreviewRevisionResult>;
  publishRevision(command: PublishRevisionCommand): Promise<PublishRevisionResult>;
  restoreRevision(command: RestoreRevisionCommand): Promise<RestoreRevisionResult>;
  unpublishMaterial(command: UnpublishMaterialCommand): Promise<UnpublishMaterialResult>;
}

export const MATERIAL_AUTHORING = Symbol("MATERIAL_AUTHORING");
