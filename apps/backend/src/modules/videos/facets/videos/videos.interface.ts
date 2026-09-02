export type VideoAccess = "free" | "membership";
export type VideoOrigin = "external_attachment" | "platform_upload";
export type VideoState =
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | "deletion_requested"
  | "deleting"
  | "deleted"
  | "delete_failed";

export interface VideoDto {
  readonly access: VideoAccess;
  readonly materialId: string;
  readonly origin: VideoOrigin;
  readonly state: VideoState;
  readonly title: string;
  readonly videoId: string;
  readonly failureCode?: string;
}

export interface VideoPresentation {
  readonly state: VideoState;
  readonly title: string;
  readonly videoId: string;
  readonly failureCode?: string;
}

export interface VideoAuthoringPresentation extends VideoPresentation {
  readonly origin: VideoOrigin;
}

export interface VideoAccessFacts {
  readonly access: VideoAccess;
  readonly materialId: string;
  readonly videoId: string;
}

export interface VideoPlayback {
  readonly access: VideoAccess;
  readonly embedLocator: string;
  readonly materialId: string;
  readonly providerVideoId: string;
  readonly videoId: string;
}

export type VideoError =
  | { readonly code: "dependency_unavailable"; readonly retryable: true }
  | { readonly code: "forbidden" }
  | { readonly code: "idempotency_key_reused" }
  | { readonly code: "invalid_request" }
  | { readonly code: "provider_mismatch" }
  | { readonly code: "upload_outcome_unknown" }
  | { readonly code: "video_deletion_not_retryable" }
  | { readonly code: "video_not_found" }
  | { readonly code: "video_not_ready" };

export type VideoResult<Value, Error extends VideoError = VideoError> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: Error }>;

type VideoOperationError<Code extends VideoError["code"]> = Extract<
  VideoError,
  { readonly code: Code }
>;

type OperationResult<Value, Code extends VideoError["code"]> = VideoResult<
  Value,
  VideoOperationError<Code>
>;

export type InitVideoUploadResult = OperationResult<
  { readonly uploadEndpoint: string; readonly video: VideoDto },
  | "dependency_unavailable"
  | "forbidden"
  | "idempotency_key_reused"
  | "invalid_request"
  | "upload_outcome_unknown"
>;

export type AttachVideoResult = OperationResult<
  VideoDto,
  "dependency_unavailable" | "forbidden" | "invalid_request" | "provider_mismatch"
>;

export type ReconcileVideoResult = OperationResult<
  VideoDto,
  "dependency_unavailable" | "forbidden" | "invalid_request" | "provider_mismatch" | "video_not_found"
>;

export type RetryVideoDeletionResult = OperationResult<
  VideoDto,
  | "dependency_unavailable"
  | "forbidden"
  | "invalid_request"
  | "video_deletion_not_retryable"
  | "video_not_found"
>;

export type AcceptVideoWebhookResult = OperationResult<
  void,
  "dependency_unavailable" | "invalid_request" | "provider_mismatch" | "video_not_found"
>;

export interface Videos {
  initUpload(input: {
    readonly access: VideoAccess;
    readonly actor: string;
    readonly byteSize: number;
    readonly filename: string;
    readonly idempotencyKey: string;
    readonly materialId: string;
    readonly title: string;
  }): Promise<InitVideoUploadResult>;
  attachExisting(input: {
    readonly access: VideoAccess;
    readonly actor: string;
    readonly materialId: string;
    readonly providerVideoId: string;
  }): Promise<AttachVideoResult>;
  reconcile(input: {
    readonly actor: string;
    readonly videoId: string;
  }): Promise<ReconcileVideoResult>;
  retryDeletion(input: {
    readonly actor: string;
    readonly videoId: string;
  }): Promise<RetryVideoDeletionResult>;
  acceptWebhook(input: {
    readonly event: string;
    readonly providerStatus?: string;
    readonly providerVideoId: string;
  }): Promise<AcceptVideoWebhookResult>;
  inspectPrimaryReference(input: {
    readonly access: VideoAccess;
    readonly materialId: string;
    readonly videoId: string;
  }): Promise<OperationResult<
    void,
    "dependency_unavailable" | "invalid_request" | "provider_mismatch" | "video_not_found" | "video_not_ready"
  >>;
  loadPresentation(input: {
    readonly materialId: string;
    readonly videoId: string;
  }): Promise<OperationResult<VideoPresentation | null, "dependency_unavailable" | "invalid_request">>;
  loadAuthoringPresentation(input: {
    readonly materialId: string;
    readonly videoId: string;
  }): Promise<OperationResult<VideoAuthoringPresentation | null, "dependency_unavailable" | "invalid_request">>;
  loadLatestDeletion(materialId: string): Promise<
    OperationResult<VideoAuthoringPresentation | null, "dependency_unavailable" | "invalid_request">
  >;
  loadAccessFacts(videoIds: readonly string[]): Promise<
    OperationResult<readonly VideoAccessFacts[], "dependency_unavailable" | "invalid_request">
  >;
  loadPlayback(videoId: string): Promise<
    OperationResult<VideoPlayback | null, "dependency_unavailable" | "invalid_request" | "video_not_ready">
  >;
  loadProgress(input: {
    readonly accountId: string;
    readonly videoId: string;
  }): Promise<OperationResult<
    { readonly positionSeconds: number } | null,
    "dependency_unavailable" | "invalid_request"
  >>;
  saveProgress(input: {
    readonly accountId: string;
    readonly durationSeconds: number;
    readonly positionSeconds: number;
    readonly videoId: string;
  }): Promise<OperationResult<
    void,
    "dependency_unavailable" | "invalid_request" | "video_not_ready"
  >>;
}
