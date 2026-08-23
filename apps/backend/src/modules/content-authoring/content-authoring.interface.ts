import type {
  DocumentChange,
  MaterialDocumentV1,
  ValidationIssue,
} from "../content-schema/index.js";

export interface SeriesMembershipInput {
  readonly seriesId: string;
  readonly ordinal: number;
}

export interface DraftMetadata {
  readonly title: string;
  readonly summary: string;
  readonly slug: string;
  readonly topicId: string;
  readonly formatId: string;
  readonly tagIds: readonly string[];
  readonly seriesMemberships: readonly SeriesMembershipInput[];
}

export interface DraftMetadataChanges {
  readonly title?: string;
  readonly summary?: string;
  readonly slug?: string;
  readonly topicId?: string;
  readonly formatId?: string;
  readonly tagIds?: readonly string[];
  readonly seriesMemberships?: readonly SeriesMembershipInput[];
}

export interface DraftSnapshot {
  readonly materialId: string;
  readonly revisionId: string;
  readonly metadata: DraftMetadata;
  readonly body: MaterialDocumentV1;
}

export interface CreateDraftCommand {
  readonly actor: string;
  readonly idempotencyKey: string;
  readonly metadata: DraftMetadata;
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
    readonly metadata?: DraftMetadataChanges;
    readonly body?: readonly DocumentChange[];
  };
}

export type ContentAuthoringError =
  | { readonly code: "forbidden" }
  | { readonly code: "material_not_found" }
  | { readonly code: "invalid_content"; readonly issues: readonly ValidationIssue[] }
  | { readonly code: "invalid_reference"; readonly issues: readonly ValidationIssue[] }
  | { readonly code: "slug_conflict"; readonly slug: string }
  | { readonly code: "duplicate_tag"; readonly tagId: string }
  | {
      readonly code: "series_ordinal_conflict";
      readonly seriesId: string;
      readonly ordinal: number;
    }
  | { readonly code: "stale_revision"; readonly currentRevisionId: string }
  | { readonly code: "idempotency_key_reused" }
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "internal_error"; readonly correlationId: string };

export type ApplicationResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: ContentAuthoringError };

export interface DraftWriteValue {
  readonly materialId: string;
  readonly revisionId: string;
  readonly draft: DraftSnapshot;
}

export type CreateDraftResult = ApplicationResult<DraftWriteValue>;
export type LoadDraftResult = ApplicationResult<DraftSnapshot>;
export type ReviseDraftResult = ApplicationResult<DraftWriteValue>;

export interface ContentAuthoring {
  createDraft(command: CreateDraftCommand): Promise<CreateDraftResult>;
  loadDraft(query: LoadDraftQuery): Promise<LoadDraftResult>;
  reviseDraft(command: ReviseDraftCommand): Promise<ReviseDraftResult>;
}

export const CONTENT_AUTHORING = Symbol("CONTENT_AUTHORING");
